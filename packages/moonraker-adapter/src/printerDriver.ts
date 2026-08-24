// Единый контракт коннекторов control-plane (MF-885, docs/architecture/printer.server.md §2.2:
// «Единый внутренний контракт PrinterDriver: getState() · sendGcode() · uploadFile() ·
// start/pause/stop · subscribeTelemetry() · camera()»). Плагинная архитектура — новый бренд
// (Bambu/Prusa/OctoPrint, v2) добавляет свою реализацию этого интерфейса, ядро не трогается.
//
// Отдельный контракт от apps/device-agent/src/driver/printerDriver.ts (MF-391): тот — внутренний
// интерфейс АГЕНТА НА УСТРОЙСТВЕ (custom-уровень, живёт в LAN принтера, поднимается device-agent
// процессом). Этот — коннектор control-plane для managed-уровня: сегодня исполняется В БРАУЗЕРЕ
// пользователя (managed-local, «браузер↔Moonraker», см. printer.server.md §1 — сервер не может
// достучаться до принтера за NAT), позже — воркерами relay/poller (managed-bridge/managed-cloud,
// custom-через-туннель, v2). Изоморфный код (только `fetch`/`WebSocket` из глобальной области,
// без Node-специфичных импортов) — обязателен именно поэтому.

export type ConnectorType = "moonraker";

export type PrinterState = "printing" | "ready" | "idle" | "paused" | "error" | "offline";

export interface PrinterStateSnapshot {
  state: PrinterState;
  /** °C, null если сенсор недоступен у этой прошивки/конфига. */
  nozzleTempC: number | null;
  bedTempC: number | null;
  chamberTempC: number | null;
  /** 0..1, null пока ничего не печатается. */
  progress: number | null;
  jobFileName: string | null;
  /** Необработанный ответ протокола — задел под будущие адаптеры, ничего не гарантирует. */
  raw: Record<string, unknown>;
}

export interface PrinterCapabilities {
  camera: boolean;
  heatedBed: boolean;
  heatedChamber: boolean;
  raw: Record<string, unknown>;
}

export interface CommandResult {
  ok: boolean;
  /** Явная человекочитаемая причина отказа — UI обязан показать её, а не молча проглотить. */
  error?: string;
}

export interface UploadFileInput {
  fileName: string;
  data: Uint8Array;
}

export interface UploadFileResult {
  ok: boolean;
  /** Путь/имя на принтере, под которым лёг файл — start(fileName) ссылается на него дальше. */
  storedAs?: string;
  error?: string;
}

export interface CameraStream {
  streamUrl: string;
  kind: string;
}

/** Пуш снимка статуса от прошивки (Moonraker notify_status_update и аналоги). Верхний слой
 *  подписывается сюда вместо polling — «polling раз в секунду с флота — это DDoS самим себе». */
export type TelemetryListener = (snapshot: PrinterStateSnapshot) => void;

export interface PrinterDriver {
  readonly connectorType: ConnectorType;

  connect(): Promise<void>;
  disconnect(): Promise<void>;

  getState(): Promise<PrinterStateSnapshot>;
  capabilities(): Promise<PrinterCapabilities>;

  /** Произвольный G-code (макросы, ручное управление) — по белому списку роли решает вызывающий
   *  код, драйвер сам ничего не фильтрует. */
  sendGcode(script: string): Promise<CommandResult>;
  uploadFile(input: UploadFileInput): Promise<UploadFileResult>;

  /** fileName — начать печать этого файла; без аргумента — продолжить текущую приостановленную
   *  печать. Архитектурный контракт называет только start/pause/stop (без отдельного resume) —
   *  адаптер сам решает, каким протокольным вызовом это выразить (см. MoonrakerAdapter: без
   *  fileName это printer.print.resume, не printer.print.start — у Moonraker это разные RPC). */
  start(fileName?: string): Promise<CommandResult>;
  pause(): Promise<CommandResult>;
  stop(): Promise<CommandResult>;

  /** Возвращает функцию отписки. Реализация не обязана поддерживать push (тогда просто ничего
   *  не вызывает) — верхний слой не должен на это полагаться жёстко для MVP-адаптеров. */
  subscribeTelemetry(listener: TelemetryListener): () => void;

  camera(): Promise<CameraStream | null>;
}
