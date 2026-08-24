import type {
  CameraStream,
  CommandResult,
  PrinterCapabilities,
  PrinterDriver,
  PrinterState,
  PrinterStateSnapshot,
  TelemetryListener,
  UploadFileInput,
  UploadFileResult,
} from "./printerDriver.ts";
import { JsonRpcClient } from "./jsonRpcClient.ts";

// Первая реализация PrinterDriver для control-plane (MF-885): Klipper-принтеры через Moonraker
// HTTP + JSON-RPC over WebSocket (FLSun/Creality-K1/Ender-V3 и т.п., пилот эпика MF-879). HTTP —
// oneshot-token (короткоживущий, в query-string) и REST-заливка файла (Moonraker не разносит
// upload по JSON-RPC — свой REST-эндпоинт), JSON-RPC over WS — всё остальное (статус/команды/
// подписка). Протокол: https://moonraker.readthedocs.io/en/latest/web_api/

export interface MoonrakerAdapterConfig {
  /** База HTTP, например http://192.168.1.42:7125 — БЕЗ финального слэша. */
  httpUrl: string;
  /** apiKey задаётся, только если у Moonraker включена авторизация (`[authorization]` секция).
   *  Trusted-LAN конфиги без авторизации — известный риск (Mainsail/Fluidd на голом порту 80),
   *  поэтому адаптер ВСЕГДА проходит oneshot-token, если ключ задан, и никогда сам не решает
   *  "доверять LAN" молча. */
  apiKey?: string;
}

const PRINT_STATE_MAP: Record<string, PrinterState> = {
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

function absoluteUrl(base: string, maybeRelative: string): string {
  try {
    return new URL(maybeRelative).toString();
  } catch {
    return new URL(maybeRelative, base).toString();
  }
}

export class MoonrakerAdapter implements PrinterDriver {
  readonly connectorType = "moonraker" as const;

  private readonly rpc = new JsonRpcClient();
  private readonly listeners = new Set<TelemetryListener>();
  private unsubscribeNotifications: (() => void) | null = null;

  constructor(private readonly config: MoonrakerAdapterConfig) {}

  async connect(): Promise<void> {
    const wsUrl = new URL(wsUrlFromHttp(this.config.httpUrl));
    if (this.config.apiKey) {
      const token = await this.requestOneshotToken();
      wsUrl.searchParams.set("token", token);
    }

    await this.rpc.connect(wsUrl.toString());
    this.unsubscribeNotifications = this.rpc.onNotification((method, params) => {
      if (method !== "notify_status_update" || this.listeners.size === 0) return;
      const status = Array.isArray(params) ? params[0] : params;
      if (typeof status !== "object" || status === null) return;
      const snapshot = mapStatus(status as Record<string, unknown>);
      for (const listener of this.listeners) listener(snapshot);
    });

    // Подписка нужна ТОЛЬКО чтобы Moonraker начал слать notify_status_update по интересующим
    // нас объектам — если верхний слой ни разу не позвал subscribeTelemetry, это просто
    // отправленный впустую RPC, не ошибка.
    await this.rpc.call("printer.objects.subscribe", { objects: STATUS_QUERY_OBJECTS });
  }

  async disconnect(): Promise<void> {
    this.unsubscribeNotifications?.();
    this.unsubscribeNotifications = null;
    this.listeners.clear();
    this.rpc.disconnect();
  }

  async capabilities(): Promise<PrinterCapabilities> {
    const [objectsResult, webcamsResult] = await Promise.all([
      this.rpc.call<{ objects: string[] }>("printer.objects.list"),
      this.rpc.call<{ webcams: unknown[] }>("server.webcams.list").catch(() => ({ webcams: [] })),
    ]);
    const objects = objectsResult.objects ?? [];

    return {
      camera: (webcamsResult.webcams ?? []).length > 0,
      heatedBed: objects.includes("heater_bed"),
      heatedChamber: objects.some((o) => o.toLowerCase().includes("chamber")),
      raw: { objects },
    };
  }

  async getState(): Promise<PrinterStateSnapshot> {
    const result = await this.rpc.call<{ status: Record<string, unknown> }>("printer.objects.query", {
      objects: STATUS_QUERY_OBJECTS,
    });
    return mapStatus(result.status);
  }

  async sendGcode(script: string): Promise<CommandResult> {
    // Deliberately fail closed in v1.  The public PrinterDriver shape is kept
    // source-compatible for callers, but Moonraker macros and arbitrary G-code
    // are not part of the safe Relay contract (MF-1140).
    void script;
    return { ok: false, error: "moonraker: arbitrary G-code is forbidden by the v1 contract" };
  }

  async pause(): Promise<CommandResult> {
    return this.runCommand("printer.print.pause");
  }

  async stop(): Promise<CommandResult> {
    return this.runCommand("printer.print.cancel");
  }

  async start(fileName?: string): Promise<CommandResult> {
    if (!fileName) return this.runCommand("printer.print.resume");
    return this.runCommand("printer.print.start", { filename: fileName });
  }

  // REST, не JSON-RPC — Moonraker выносит upload в отдельный HTTP-эндпоинт (тело — multipart,
  // JSON-RPC over WS для бинарных payload'ов не годится). Не chunked — потоковая докачка ≥100 МБ
  // с резюме (MF-391) — отдельный шаг поверх ЭТОГО примитива, не часть ядра коннектора.
  async uploadFile(input: UploadFileInput): Promise<UploadFileResult> {
    const form = new FormData();
    form.set("root", "gcodes");
    form.set(
      "file",
      new Blob([new Uint8Array(input.data)], { type: "application/octet-stream" }),
      input.fileName,
    );

    try {
      const response = await fetch(`${this.config.httpUrl}/server/files/upload`, {
        method: "POST",
        headers: this.config.apiKey ? { "X-Api-Key": this.config.apiKey } : undefined,
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

  async camera(): Promise<CameraStream | null> {
    const result = await this.rpc
      .call<{ webcams: Array<{ stream_url?: string; snapshot_url?: string; service?: string }> }>(
        "server.webcams.list",
      )
      .catch(() => ({ webcams: [] }));
    const first = result.webcams?.[0];
    if (!first?.stream_url) return null;
    return { streamUrl: absoluteUrl(this.config.httpUrl, first.stream_url), kind: first.service ?? "mjpeg" };
  }

  subscribeTelemetry(listener: TelemetryListener): () => void {
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
  // предваряющий HTTP-заголовок): https://moonraker.readthedocs.io/en/latest/web_api/#authorization
  private async requestOneshotToken(): Promise<string> {
    const response = await fetch(`${this.config.httpUrl}/access/oneshot_token`, {
      headers: { "X-Api-Key": this.config.apiKey! },
    });
    if (!response.ok) {
      throw new Error(`moonraker oneshot_token -> HTTP ${response.status}`);
    }
    const body = (await response.json()) as { result?: string };
    if (!body.result) throw new Error("moonraker oneshot_token: empty result");
    return body.result;
  }
}

function mapStatus(status: Record<string, unknown>): PrinterStateSnapshot {
  const printStats = (status.print_stats ?? {}) as Record<string, unknown>;
  const heaterBed = (status.heater_bed ?? {}) as Record<string, unknown>;
  const extruder = (status.extruder ?? {}) as Record<string, unknown>;
  const chamber = (status.chamber ?? {}) as Record<string, unknown>;
  const virtualSdcard = (status.virtual_sdcard ?? {}) as Record<string, unknown>;

  const state = typeof printStats.state === "string" ? printStats.state : undefined;
  const fileName = typeof printStats.filename === "string" && printStats.filename ? printStats.filename : null;

  return {
    state: (state ? PRINT_STATE_MAP[state] : undefined) ?? "idle",
    nozzleTempC: toNumber(extruder.temperature),
    bedTempC: toNumber(heaterBed.temperature),
    chamberTempC: toNumber(chamber.temperature),
    progress: toNumber(virtualSdcard.progress),
    jobFileName: fileName,
    raw: status,
  };
}
