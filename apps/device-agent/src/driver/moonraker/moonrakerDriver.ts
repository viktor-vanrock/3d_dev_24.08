import type {
  CameraInfo,
  CommandResult,
  DriverCapabilities,
  PrinterCommand,
  PrinterConnectionStatus,
  PrinterDriver,
  PrinterStatusSnapshot,
  RemoteFileInspection,
  StatusUpdateListener,
  UploadGcodeInput,
  UploadGcodeStreamInput,
  UploadResult,
} from "../printerDriver.ts";
import { createHash, randomUUID } from "node:crypto";
import { JsonRpcClient } from "./jsonRpcClient.ts";
import { buildIdentity, type DeviceIdentityV1 } from "../../identity.ts";

// Первый драйвер под единый PrinterDriver (MF-391 Ф2 эпика MF-26, шаг 1). HTTP — oneshot-token
// (карточка: «одноразовый, ~5 с, в query-string») и REST-заливка файла (Moonraker не разносит
// upload по JSON-RPC — свой REST-эндпоинт), JSON-RPC over WS — всё остальное (статус/команды/
// подписка). API-key принтера живёт ТОЛЬКО в этом процессе (передаётся в конструктор из
// локального конфига агента) — наружу утекает не он сам, а одноразовый WS-токен с TTL ~5с,
// который сам по себе бесполезен после открытия сокета (см. readme нового реального Moonraker
// API: https://moonraker.readthedocs.io/en/latest/web_api/#authorization).

export interface MoonrakerDriverConfig {
  /** База HTTP, например http://192.168.1.42:7125 — БЕЗ финального слэша. */
  httpUrl: string;
  /** apiKey задаётся, только если у Moonraker включена авторизация (`[authorization]` секция).
   *  Trusted-LAN конфиги без авторизации — известный риск (Mainsail/Fluidd на голом порту 80,
   *  см. CLAUDE.md § «Контур 2»), поэтому агент ВСЕГДА пытается пройти oneshot-token, если ключ
   *  задан, и никогда сам не решает "доверять LAN" молча. */
  apiKey?: string;
}

type MoonrakerConfigQueryResult = {
  status?: { configfile?: { settings?: Record<string, unknown> } };
  configfile?: { settings?: Record<string, unknown> };
};

type ByteStream = { getReader(): { read(): Promise<{ done: boolean; value?: Uint8Array }> } };

function isByteStream(value: unknown): value is ByteStream {
  return typeof value === "object" && value !== null && "getReader" in value && typeof value.getReader === "function";
}

const PRINT_STATE_MAP: Record<string, PrinterConnectionStatus> = {
  standby: "idle",
  printing: "printing",
  paused: "paused",
  complete: "ready",
  cancelled: "ready",
  error: "error",
};

const STATUS_QUERY_OBJECTS = {
  print_stats: null,
  heater_bed: null,
  extruder: null,
  virtual_sdcard: null,
  chamber: null,
} as const;

function wsUrlFromHttp(httpUrl: string): string {
  const url = new URL(httpUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = "/websocket";
  return url.toString();
}

function toNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export class MoonrakerDriver implements PrinterDriver {
  readonly firmwareClass = "klipper";

  private readonly rpc = new JsonRpcClient();
  private readonly listeners = new Set<StatusUpdateListener>();
  private unsubscribeNotifications: (() => void) | null = null;

  constructor(private readonly config: MoonrakerDriverConfig) {}

  async connect(): Promise<void> {
    const wsUrl = new URL(wsUrlFromHttp(this.config.httpUrl));
    if (this.config.apiKey) {
      const token = await this.requestOneshotToken(this.config.apiKey);
      wsUrl.searchParams.set("token", token);
    }

    await this.rpc.connect(wsUrl.toString());
    this.unsubscribeNotifications = this.rpc.onNotification((method, params) => {
      if (method !== "notify_status_update" || this.listeners.size === 0) return;
      const status: unknown = Array.isArray(params) ? params[0] : params;
      if (typeof status !== "object" || status === null) return;
      const snapshot = mapStatus(status as Record<string, unknown>);
      for (const listener of this.listeners) listener(snapshot);
    });

    // Подписка нужна ТОЛЬКО чтобы Moonraker начал слать notify_status_update по интересующим
    // нас объектам — если верхний слой (телеметрия, MF-391 шаг 2) ни разу не позвал
    // onStatusUpdate, это просто отправленный впустую RPC, не ошибка.
    await this.rpc.call("printer.objects.subscribe", { objects: STATUS_QUERY_OBJECTS });
  }

  disconnect(): Promise<void> {
    this.unsubscribeNotifications?.();
    this.unsubscribeNotifications = null;
    this.listeners.clear();
    this.rpc.disconnect();
    return Promise.resolve();
  }

  async capabilities(): Promise<DriverCapabilities> {
    const [objectsResult, webcamsResult] = await Promise.all([
      this.rpc.call<{ objects: string[] }>("printer.objects.list"),
      this.rpc.call<{ webcams: unknown[] }>("server.webcams.list").catch(() => ({ webcams: [] })),
    ]);
    const objects = objectsResult.objects;

    const heatedBed = objects.includes("heater_bed");
    const heatedChamber = objects.some((o) => o.toLowerCase().includes("chamber"));
    const multiExtruder = objects.includes("extruder1");
    const camera = webcamsResult.webcams.length > 0;

    const supportedCommands: PrinterCommand[] = objects.includes("print_stats")
      ? ["pause", "resume", "cancel", "start"]
      : [];

    return {
      camera,
      heatedBed,
      heatedChamber,
      multiExtruder,
      supportedCommands,
      raw: { objects },
    };
  }

  async status(): Promise<PrinterStatusSnapshot> {
    const result = await this.rpc.call<{ status: Record<string, unknown> }>("printer.objects.query", {
      objects: STATUS_QUERY_OBJECTS,
    });
    return mapStatus(result.status);
  }

  async identity(deviceId: string, agentVersion: string): Promise<DeviceIdentityV1> {
    const [info, config] = await Promise.all([
      this.rpc.call<Record<string, unknown>>("server.info"),
      this.rpc
        .call<MoonrakerConfigQueryResult>("printer.objects.query", { objects: { configfile: null } })
        .catch((): MoonrakerConfigQueryResult => ({})),
    ]);
    const version = typeof info.version === "string" ? info.version : null;
    const settings = config.status?.configfile?.settings ?? config.configfile?.settings ?? {};
    return buildIdentity({ deviceId, agentVersion, klipperVersion: version, config: settings });
  }

  async pause(): Promise<CommandResult> {
    return this.runCommand("printer.print.pause");
  }

  async resume(): Promise<CommandResult> {
    return this.runCommand("printer.print.resume");
  }

  async cancel(): Promise<CommandResult> {
    return this.runCommand("printer.print.cancel");
  }

  async startPrint(fileName: string): Promise<CommandResult> {
    return this.runCommand("printer.print.start", { filename: fileName });
  }

  // REST, не JSON-RPC — Moonraker выносит upload в отдельный HTTP-эндпоинт (тело — multipart,
  // JSON-RPC over WS для бинарных payload'ов не годится). Не chunked: докачка ≥100 МБ с резюме —
  // отдельный Ф2-шаг (MF-391) поверх ЭТОГО примитива (тот же паттерн, что file_chunk-каркас в
  // apps/relay Ф1 — фрейминг есть, реальный приёмник добавляется здесь, стриминг с резюме — уровнем
  // выше).
  async uploadGcode(input: UploadGcodeInput): Promise<UploadResult> {
    const form = new FormData();
    form.set("root", input.root ?? "gcodes");
    form.set(
      "file",
      new Blob([new Uint8Array(input.data)], { type: "application/octet-stream" }),
      input.fileName,
    );

    try {
      const response = await fetch(`${this.config.httpUrl}/server/files/upload`, {
        method: "POST",
        ...(this.config.apiKey ? { headers: { "X-Api-Key": this.config.apiKey } } : {}),
        body: form,
      });
      if (!response.ok) {
        return { ok: false, error: `moonraker upload -> HTTP ${response.status}` };
      }
      const body = (await response.json()) as { item?: { path?: string } };
      return { ok: true, storedAs: body.item?.path ?? input.fileName };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : "upload failed" };
    }
  }

  /** Multipart upload поверх ReadableStream: Node не буферизует весь G-code в памяти агента. */
  async uploadGcodeStream(input: UploadGcodeStreamInput): Promise<UploadResult> {
    if (!Number.isSafeInteger(input.size) || input.size < 0) return { ok: false, error: "invalid stream size" };
    const boundary = `----portal-${randomUUID()}`;
    const root = input.root ?? "gcodes";
    const header = Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="root"\r\n\r\n${root}\r\n` +
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${input.fileName}"\r\n` +
        `Content-Type: application/octet-stream\r\n\r\n`,
    );
    const footer = Buffer.from(`\r\n--${boundary}--\r\n`);
    const iterator = input.data[Symbol.asyncIterator]();
    let phase: "header" | "data" | "footer" | "done" = "header";
    let sent = 0;
    const body = new ReadableStream<Uint8Array>({
      async pull(controller) {
        if (phase === "header") {
          controller.enqueue(header);
          phase = "data";
          return;
        }
        if (phase === "data") {
          const next = await iterator.next();
          if (next.done) {
            if (sent !== input.size) {
              controller.error(new Error(`stream size mismatch: expected ${input.size}, got ${sent}`));
              phase = "done";
              return;
            }
            controller.enqueue(footer);
            phase = "footer";
            return;
          }
          const chunk = new Uint8Array(next.value);
          sent += chunk.byteLength;
          if (sent > input.size) {
            controller.error(new Error("stream exceeds declared size"));
            phase = "done";
            return;
          }
          controller.enqueue(chunk);
          return;
        }
        if (phase === "footer") {
          phase = "done";
          controller.close();
        }
      },
    });

    try {
      const response = await fetch(`${this.config.httpUrl}/server/files/upload`, {
        method: "POST",
        headers: {
          "content-type": `multipart/form-data; boundary=${boundary}`,
          ...(this.config.apiKey ? { "X-Api-Key": this.config.apiKey } : {}),
        },
        body,
        duplex: "half",
      });
      if (!response.ok) return { ok: false, error: `moonraker upload -> HTTP ${response.status}` };
      const result = (await response.json()) as { item?: { path?: string } };
      return { ok: true, storedAs: result.item?.path ?? input.fileName };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : "stream upload failed" };
    }
  }

  async inspectFile(input: { readonly fileName: string; readonly root: "gcodes" | "config" }): Promise<RemoteFileInspection> {
    try {
      const path = input.fileName.split("/").map(encodeURIComponent).join("/");
      const response = await fetch(`${this.config.httpUrl}/server/files/${input.root}/${path}`, {
        ...(this.config.apiKey ? { headers: { "X-Api-Key": this.config.apiKey } } : {}),
      });
      if (response.status === 404) return { status: "absent" };
      const body: unknown = response.body;
      if (!response.ok || !isByteStream(body)) return { status: "unknown" };
      const hash = createHash("sha256");
      let sizeBytes = 0;
      const reader = body.getReader();
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        if (chunk.value === undefined) return { status: "unknown" };
        sizeBytes += chunk.value.byteLength;
        hash.update(chunk.value);
      }
      return { status: "present", storedAs: `${input.root}/${input.fileName}`, sizeBytes, sha256: hash.digest("hex") };
    } catch {
      return { status: "unknown" };
    }
  }

  async camera(): Promise<CameraInfo | null> {
    const result = await this.rpc
      .call<{ webcams: Array<{ stream_url?: string; snapshot_url?: string; service?: string }> }>(
        "server.webcams.list",
      )
      .catch(() => ({ webcams: [] }));
    const first = result.webcams[0];
    if (!first?.stream_url) return null;
    return { streamUrl: absoluteUrl(this.config.httpUrl, first.stream_url), kind: first.service ?? "mjpeg" };
  }

  onStatusUpdate(listener: StatusUpdateListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private async runCommand(method: string, params?: Record<string, unknown>): Promise<CommandResult> {
    try {
      await this.rpc.call(method, params);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : "command failed" };
    }
  }

  // GET /access/oneshot_token — Moonraker выдаёт короткоживущий (~5с) токен для авторизации
  // WS-хендшейка в query-string (сам API-key в WS URL никогда не попадает, только в этот
  // предваряющий HTTP-заголовок). См. карточку MF-391 шаг 1: «авторизация через oneshot-token
  // (одноразовый, ~5 с, в query-string) для открытия ws».
  private async requestOneshotToken(apiKey: string): Promise<string> {
    const response = await fetch(`${this.config.httpUrl}/access/oneshot_token`, {
      headers: { "X-Api-Key": apiKey },
    });
    if (!response.ok) {
      throw new Error(`moonraker oneshot_token -> HTTP ${response.status}`);
    }
    const body = (await response.json()) as { result?: string };
    if (!body.result) throw new Error("moonraker oneshot_token: empty result");
    return body.result;
  }
}

function mapStatus(status: Record<string, unknown>): PrinterStatusSnapshot {
  const printStats = (status.print_stats ?? {}) as Record<string, unknown>;
  const heaterBed = (status.heater_bed ?? {}) as Record<string, unknown>;
  const extruder = (status.extruder ?? {}) as Record<string, unknown>;
  const chamber = (status.chamber ?? {}) as Record<string, unknown>;
  const virtualSdcard = (status.virtual_sdcard ?? {}) as Record<string, unknown>;

  const state = typeof printStats.state === "string" ? printStats.state : undefined;
  const fileName = typeof printStats.filename === "string" && printStats.filename ? printStats.filename : null;

  return {
    status: (state ? PRINT_STATE_MAP[state] : undefined) ?? "idle",
    nozzleTempC: toNumber(extruder.temperature),
    bedTempC: toNumber(heaterBed.temperature),
    chamberTempC: toNumber(chamber.temperature),
    // `virtual_sdcard.progress` сохраняет последнее значение после завершения job.
    // Публикуем его только пока печать действительно идёт (или приостановлена),
    // иначе завершённый принтер выглядит как активный с progress=1.
    progress: state === "printing" || state === "paused" ? toNumber(virtualSdcard.progress) : null,
    // Moonraker без плагина `history` не даёт отдельный опаковый job id — filename на практике
    // и есть идентичность текущего job на Ф2 шаге 1; реальный history.job_id — задел для
    // MF-391 шага 2 (телеметрия), когда появится писатель device_jobs.
    jobId: fileName,
    jobFileName: fileName,
    raw: status,
  };
}

function absoluteUrl(base: string, maybeRelative: string): string {
  try {
    return new URL(maybeRelative).toString();
  } catch {
    return new URL(maybeRelative, base).toString();
  }
}
