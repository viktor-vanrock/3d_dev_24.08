// Единый внутренний контракт агента (MF-391 Ф2 эпика MF-26, шаг 1: «определить единый
// внутренний интерфейс PrinterDriver … и реализовать первый драйвер — Klipper/Moonraker»).
// Один интерфейс на все прошивки (Klipper/Moonraker сейчас, Bambu/Prusa/OctoPrint/Creality —
// будущие Ф2-драйверы, см. user_printers.firmware_class в domain.model.md) — верхний слой
// агента (relay-соединение, телеметрия push, командный слой с подписью/идемпотентностью)
// работает ТОЛЬКО через эти методы и никогда не знает про конкретный протокол принтера.
//
// Границы этого шага (MF-391 «шаг 1»): интерфейс + Moonraker-реализация connect/capabilities/
// status/pause/resume/cancel/uploadGcode/startPrint/camera, доказано против эмулированного
// Moonraker (см. src/testing/fakeMoonraker.ts). Подпись/идемпотентность команд (nonce/seq,
// белый список по роли), push реального статуса в printer_state через relay и chunked-докачка
// ≥100 МБ — отдельные Ф2-шаги (сабкарты MF-391), поверх ЭТОГО интерфейса, не внутри него.

export type PrinterConnectionStatus = "printing" | "ready" | "idle" | "paused" | "error" | "offline";

export interface PrinterStatusSnapshot {
  status: PrinterConnectionStatus;
  /** °C, null если сенсор недоступен у этой прошивки/конфига. */
  nozzleTempC: number | null;
  bedTempC: number | null;
  chamberTempC: number | null;
  /** 0..1, null пока ничего не печатается. */
  progress: number | null;
  jobId: string | null;
  jobFileName: string | null;
  /** Свободная форма для полей, специфичных прошивке — не расширяем реляционный снэпшот ради
   *  одного вендора (тот же принцип, что device_state.metrics jsonb в domain.model.md). */
  raw: Record<string, unknown>;
}

export interface DriverCapabilities {
  camera: boolean;
  heatedBed: boolean;
  heatedChamber: boolean;
  multiExtruder: boolean;
  /** Команды, которые эта прошивка/конфиг реально поддерживает — командный слой (MF-391 шаг 3)
   *  сверяет запрошенную команду с этим списком ДО отправки на устройство, а не только с общим
   *  белым списком ролей. */
  supportedCommands: PrinterCommand[];
  /** Необработанный ответ прошивки — задел для будущих драйверов, ничего не гарантирует. */
  raw: Record<string, unknown>;
}

export type PrinterCommand = "pause" | "resume" | "cancel" | "start";

export interface CommandResult {
  ok: boolean;
  /** Человекочитаемая причина отказа — «явная ошибка», которую эпик требует показывать в UI. */
  error?: string;
}

/** Moonraker root каталога загрузки — "gcodes" (по умолчанию, печатаемое) или "config"
 *  (слайсер-профиль MF-1942: файл ложится рядом с printer.cfg, доступен через
 *  Mainsail/Fluidd file manager, никогда не участвует в printer.print.start). */
export type UploadRoot = "gcodes" | "config";

export interface UploadGcodeInput {
  fileName: string;
  data: Uint8Array;
  root?: UploadRoot;
}

export interface UploadResult {
  ok: boolean;
  /** Путь/имя, под которым файл лёг на принтер — startPrint(fileName) далее ссылается на него. */
  storedAs?: string;
  error?: string;
}

/** Потоковая форма upload для слабого устройства: файл не собирается целиком в памяти агента. */
export interface UploadGcodeStreamInput {
  fileName: string;
  size: number;
  data: AsyncIterable<Uint8Array>;
  root?: UploadRoot;
}

export type RemoteFileInspection =
  | { readonly status: "present"; readonly storedAs: string; readonly sizeBytes: number; readonly sha256: string }
  | { readonly status: "absent" }
  | { readonly status: "unknown" };

export interface CameraInfo {
  /** URL локального видеопотока (MJPEG/HLS и т.п.) — относительно LAN агента, наружу не течёт
   *  без relay video-канала (задел Ф1, MF-794 readme § «Протокол»). */
  streamUrl: string;
  kind: string;
}

export interface PrinterIdentitySnapshot {
  readonly schema: "identity.v1";
  readonly deviceId: string;
  readonly model: string | null;
  readonly agentVersion: string;
  readonly klipperVersion: string | null;
  readonly configFingerprint: string;
  readonly configSource: "moonraker";
}

/** Снимок статуса пуш-ом от прошивки (Moonraker notify_status_update и аналоги). Верхний слой
 *  (MF-391 шаг 2, телеметрия) подписывается сюда вместо polling — «polling раз в секунду с
 *  флота — это DDoS самим себе» (CLAUDE.md § «Принципы девайс-контура»). */
export type StatusUpdateListener = (snapshot: PrinterStatusSnapshot) => void;

export interface PrinterDriver {
  readonly firmwareClass: string;

  connect(): Promise<void>;
  disconnect(): Promise<void>;

  capabilities(): Promise<DriverCapabilities>;
  status(): Promise<PrinterStatusSnapshot>;

  pause(): Promise<CommandResult>;
  resume(): Promise<CommandResult>;
  cancel(): Promise<CommandResult>;

  uploadGcode(input: UploadGcodeInput): Promise<UploadResult>;
  /** Необязателен для старых адаптеров; файловый relay использует его, когда он есть. */
  uploadGcodeStream?(input: UploadGcodeStreamInput): Promise<UploadResult>;
  /** Crash-only reconciliation hook. Implementations hash remote bytes instead of trusting upload metadata. */
  inspectFile?(input: { readonly fileName: string; readonly root: UploadRoot }): Promise<RemoteFileInspection>;
  startPrint(fileName: string): Promise<CommandResult>;

  camera(): Promise<CameraInfo | null>;

  identity?(deviceId: string, agentVersion: string): Promise<PrinterIdentitySnapshot>;

  /** Возвращает функцию отписки. Реализация не обязана поддерживать push (тогда просто ничего
   *  не вызывает) — верхний слой не должен на это полагаться жёстко для MVP-драйверов. */
  onStatusUpdate(listener: StatusUpdateListener): () => void;
}
