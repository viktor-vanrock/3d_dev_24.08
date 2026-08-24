import { createSocket } from "node:dgram";
import type {
  ConnectInput,
  ConnectResult,
  DiscoveredPrinter,
  PrinterConnector,
  PrinterEndpoint,
} from "../common/connector.ts";
import { authenticateWithGate } from "../common/authGate.ts";
import type { ConnectorTokenStore } from "../common/tokenStore.ts";
import { MoonrakerDriver } from "../../driver/moonraker/moonrakerDriver.ts";

// Snapmaker U1 (connector/snapmaker/README.md): пока не подтверждено разведкой Polygon, что
// форк Orca несовместим с Moonraker, коннектор реализован поверх MoonrakerDriver — своего
// driver'а здесь нет (connector/README.md § «Разделение ответственности», карточка MF-1976
// прямо запрещает писать новый driver без доказанной несовместимости).

const DEFAULT_MOONRAKER_PORT = 7125;
const DEFAULT_DISCOVER_TIMEOUT_MS = 4000;
const DEFAULT_IDENTIFY_TIMEOUT_MS = 5000;

export interface IdentityCheckResult {
  ok: boolean;
  /** `hostname` из ответа Moonraker, если есть — единственный доступный сегодня сигнал модели
   *  (см. README «Что дальше»: настоящее сопоставление с "Snapmaker U1" ждёт разведки Polygon). */
  model: string | null;
  raw: Record<string, unknown>;
}

/**
 * Проверка "это живой Moonraker" — тот же паттерн, что уже доказан в
 * apps/web/src/park/ipcheck.ts: `GET /printer/info` без авторизации есть на любом Klipper+
 * Moonraker по умолчанию. Наличие `result` в теле — сигнал "это Moonraker", а не первый
 * попавшийся HTTP-сервер на порту 7125 (то, что коннектор обязан отличать как wrong-device).
 */
export interface IdentityProbe {
  identify(endpoint: PrinterEndpoint, timeoutMs: number): Promise<IdentityCheckResult>;
}

export class HttpMoonrakerIdentityProbe implements IdentityProbe {
  constructor(private readonly fetchImpl: typeof fetch = fetch) {}

  async identify(endpoint: PrinterEndpoint, timeoutMs: number): Promise<IdentityCheckResult> {
    const port = endpoint.port ?? DEFAULT_MOONRAKER_PORT;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
    }, timeoutMs);
    try {
      const response = await this.fetchImpl(`http://${endpoint.host}:${port}/printer/info`, {
        signal: controller.signal,
        redirect: "error",
      });
      if (!response.ok) return { ok: false, model: null, raw: {} };
      const body = (await response.json()) as { result?: Record<string, unknown> };
      if (!body.result) return { ok: false, model: null, raw: {} };
      const hostname = typeof body.result.hostname === "string" ? body.result.hostname : null;
      return { ok: true, model: hostname, raw: body.result };
    } catch {
      return { ok: false, model: null, raw: {} };
    } finally {
      clearTimeout(timer);
    }
  }
}

export interface MdnsCandidate {
  host: string;
  port?: number;
  raw: Record<string, unknown>;
}

/**
 * LAN-обнаружение. Из dev-vm до принтера сети нет (connector/README.md § «Правила») — реальная
 * реализация исполняется у воркера с LAN-доступом (полигон/будущий парк-воркер), здесь только
 * контракт + best-effort UDP-реализация, тесты подставляют fake.
 */
export interface MdnsBrowser {
  browse(timeoutMs: number): Promise<MdnsCandidate[]>;
}

/** LAN-скан недоступен из-за прав/сети (не спутывать с «просканировали, никого не нашли»). */
export class MdnsPermissionDeniedError extends Error {
  constructor(cause?: unknown) {
    super(`mdns discovery недоступен: нет прав/интерфейса для multicast (${String(cause)})`);
  }
}

const MDNS_MULTICAST_ADDR = "224.0.0.251";
const MDNS_PORT = 5353;

// Стандартный meta-query "_services._dns-sd._udp.local" (PTR), на который отвечает почти
// любой mDNS-респондер (в т.ч. Avahi на Klipper-хостах). Полный DNS-SD парсинг ответа (SRV/TXT
// с портом и именем сервиса) — задел на будущее, когда появится больше вендоров с нестандартным
// портом; сегодня нам достаточно знать, С КАКОГО LAN-адреса пришёл ответ — остальное решает
// HttpMoonrakerIdentityProbe (см. выше), это надёжнее гадания по TXT-записям неизвестного нам
// формата.
function buildDnsSdQuery(): Buffer {
  const labels = "_services._dns-sd._udp.local".split(".").filter(Boolean);
  const parts: Buffer[] = [];
  for (const label of labels) {
    const buf = Buffer.from(label, "utf8");
    parts.push(Buffer.from([buf.length]), buf);
  }
  parts.push(Buffer.from([0]));
  const header = Buffer.alloc(12);
  header.writeUInt16BE(1, 4); // qdcount = 1
  const footer = Buffer.from([0x00, 0x0c, 0x00, 0x01]); // QTYPE=PTR(12), QCLASS=IN(1)
  return Buffer.concat([header, Buffer.concat(parts), footer]);
}

export class UdpMdnsBrowser implements MdnsBrowser {
  browse(timeoutMs: number): Promise<MdnsCandidate[]> {
    return new Promise((resolve, reject) => {
      const socket = createSocket({ type: "udp4", reuseAddr: true });
      const hosts = new Map<string, MdnsCandidate>();
      let settled = false;

      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        socket.close();
        resolve([...hosts.values()]);
      };
      const fail = (err: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        socket.close();
        reject(err);
      };

      const timer = setTimeout(finish, timeoutMs);

      socket.on("error", (err) => {
        fail(new MdnsPermissionDeniedError(err));
      });
      socket.on("message", (_msg, rinfo) => {
        if (!hosts.has(rinfo.address)) hosts.set(rinfo.address, { host: rinfo.address, raw: { source: "mdns" } });
      });

      socket.bind(0, () => {
        try {
          socket.setBroadcast(true);
          socket.addMembership(MDNS_MULTICAST_ADDR);
        } catch (err) {
          fail(new MdnsPermissionDeniedError(err));
          return;
        }
        socket.send(buildDnsSdQuery(), MDNS_PORT, MDNS_MULTICAST_ADDR, (err) => {
          if (err) fail(new MdnsPermissionDeniedError(err));
        });
      });
    });
  }
}

export interface SnapmakerConnectorConfig {
  mdnsBrowser?: MdnsBrowser;
  identityProbe?: IdentityProbe;
  discoverTimeoutMs?: number;
  identifyTimeoutMs?: number;
  /** Персист вендор-токена (connector/common/tokenStore.ts) — по умолчанию файл в MULTICA_AGENT_HOME. */
  tokenStore?: ConnectorTokenStore;
}

function formatEndpoint(endpoint: PrinterEndpoint): string {
  return endpoint.port ? `${endpoint.host}:${endpoint.port}` : endpoint.host;
}

// Оператор вводит вручную либо голый IP ("192.168.88.82", дефолтный Moonraker-порт 7125
// применится сам), либо IP:port, если у него нестандартный порт. Не претендует на полный
// парсинг hostname/IPv6 — этого хватает для «ручной IP fallback» из карточки.
function parseManualEndpoint(input: string): PrinterEndpoint {
  const lastColon = input.lastIndexOf(":");
  if (lastColon === -1) return { host: input };
  const host = input.slice(0, lastColon);
  const port = Number(input.slice(lastColon + 1));
  return Number.isInteger(port) && port > 0 ? { host, port } : { host: input };
}

export class SnapmakerConnector implements PrinterConnector {
  readonly vendor = "snapmaker" as const;

  private readonly mdnsBrowser: MdnsBrowser;
  private readonly identityProbe: IdentityProbe;
  private readonly discoverTimeoutMs: number;
  private readonly identifyTimeoutMs: number;
  private readonly tokenStore: ConnectorTokenStore | undefined;
  private driver: MoonrakerDriver | null = null;

  constructor(config: SnapmakerConnectorConfig = {}) {
    this.mdnsBrowser = config.mdnsBrowser ?? new UdpMdnsBrowser();
    this.identityProbe = config.identityProbe ?? new HttpMoonrakerIdentityProbe();
    this.discoverTimeoutMs = config.discoverTimeoutMs ?? DEFAULT_DISCOVER_TIMEOUT_MS;
    this.identifyTimeoutMs = config.identifyTimeoutMs ?? DEFAULT_IDENTIFY_TIMEOUT_MS;
    this.tokenStore = config.tokenStore;
  }

  /**
   * subnetHint — это конкретный IP оператора (ручной ввод), НЕ CIDR: настоящего скана подсети
   * сегодня нет (connector/README.md: доступен ровно один принтер по известному IP), только
   * mDNS-автообнаружение либо ручной адрес. Бросает MdnsPermissionDeniedError, если mDNS
   * недоступен из-за прав/сети (верхний слой обязан честно показать это отдельно от «просто
   * ничего не нашли», см. карточку MF-1976 «Границы»); таймаут/пустой скан — обычный `[]`.
   */
  async discover(subnetHint?: string): Promise<DiscoveredPrinter[]> {
    if (subnetHint) {
      const endpoint = parseManualEndpoint(subnetHint);
      const identity = await this.identityProbe.identify(endpoint, this.identifyTimeoutMs);
      if (!identity.ok) return [];
      return [{ endpoint, vendor: "snapmaker", model: identity.model, raw: identity.raw }];
    }

    const candidates = await this.mdnsBrowser.browse(this.discoverTimeoutMs);
    const results: DiscoveredPrinter[] = [];
    for (const candidate of candidates) {
      const endpoint: PrinterEndpoint = {
        host: candidate.host,
        ...(candidate.port === undefined ? {} : { port: candidate.port }),
      };
      const identity = await this.identityProbe.identify(endpoint, this.identifyTimeoutMs);
      if (!identity.ok) continue; // mDNS-шум/чужое устройство — не показываем оператору как кандидата
      results.push({ endpoint, vendor: "snapmaker", model: identity.model, raw: { ...candidate.raw, ...identity.raw } });
    }
    return results;
  }

  /**
   * Порядок: 1) identity-check (честный wrong-device отказ ДО того, как дёргать оператора в
   * Telegram за подтверждением непонятно чего) 2) OperatorConfirmGate/токен 3) MoonrakerDriver.
   * Если сам driver.connect() падает уже ПОСЛЕ успешного identity-check, считаем это протухшим/
   * отозванным локальным токеном (см. common/README.md «Auth-флоу») и один раз повторяем через
   * forcePrompt:true — не тихий бесконечный ретрай, ровно одна повторная попытка с оператором.
   */
  async connect(input: ConnectInput): Promise<ConnectResult> {
    const identity = await this.identityProbe.identify(input.endpoint, this.identifyTimeoutMs);
    if (!identity.ok) {
      return {
        ok: false,
        error: `${formatEndpoint(input.endpoint)} не отвечает как Moonraker — похоже на wrong device, а не Snapmaker U1`,
      };
    }

    const attempt = async (forcePrompt: boolean): Promise<ConnectResult> => {
      const auth = await authenticateWithGate({
        vendor: "snapmaker",
        endpoint: input.endpoint,
        ...(!forcePrompt && input.savedToken !== undefined ? { savedToken: input.savedToken } : {}),
        confirmGate: input.confirmGate,
        reason: "confirm-on-printer",
        message: `Snapmaker U1 ${formatEndpoint(input.endpoint)}: подтверди подключение на принтере или пришли токен`,
        forcePrompt,
        ...(this.tokenStore === undefined ? {} : { tokenStore: this.tokenStore }),
      });
      if (!auth.ok) return { ok: false, error: auth.error };

      const driver = new MoonrakerDriver({
        httpUrl: `http://${formatEndpoint(input.endpoint)}`,
        ...(auth.token === undefined ? {} : { apiKey: auth.token }),
      });
      try {
        await driver.connect();
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : "moonraker connect failed" };
      }

      this.driver = driver;
      return { ok: true, driver, ...(auth.token === undefined ? {} : { token: auth.token }) };
    };

    const first = await attempt(false);
    if (first.ok || !input.savedToken) return first;
    // Протух именно сохранённый токен (без него и без forcePrompt мы бы и так пошли через
    // gate) — повторяем РОВНО один раз, заставляя оператора подтвердить заново.
    return attempt(true);
  }

  async disconnect(): Promise<void> {
    await this.driver?.disconnect();
    this.driver = null;
  }
}
