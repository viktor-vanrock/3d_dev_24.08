/** HTTP-шов статуса firmware-пилота: Back/Fleet → Front. */

export const FIRMWARE_PILOT_CONTRACT_VERSION = "firmware-pilot.v1" as const;
export const FIRMWARE_PILOT_FRESH_FOR_HOURS = 24 as const;

export const FIRMWARE_PILOT_STAGES = ["not_started", "building", "burn_in", "ready", "stopped"] as const;
export type FirmwarePilotStage = (typeof FIRMWARE_PILOT_STAGES)[number];

export const FIRMWARE_PILOT_SOURCES = ["fleet", "operator"] as const;
export type FirmwarePilotSource = (typeof FIRMWARE_PILOT_SOURCES)[number];

export const FIRMWARE_PILOT_CONFIDENCE = ["limited", "verified"] as const;
export type FirmwarePilotConfidence = (typeof FIRMWARE_PILOT_CONFIDENCE)[number];

type ReportedFirmwarePilotStatus = {
  status: "reported";
  updated_at: string;
  freshness: "fresh" | "stale";
  source: FirmwarePilotSource;
};

/**
 * `stale` вычисляет producer при чтении: `now - updated_at > 24h`.
 * Front не показывает устаревшую запись как текущий этап.
 */
export type FirmwarePilotStatus =
  | (ReportedFirmwarePilotStatus & { stage: Exclude<FirmwarePilotStage, "ready">; confidence: FirmwarePilotConfidence })
  | (ReportedFirmwarePilotStatus & { stage: "ready"; confidence: "verified" })
  | {
    /** Точная модель не участвует в пилоте либо Fleet не может выдать валидный факт. */
    status: "no_data";
  };

const REPORTED_STATUS_KEYS = ["status", "stage", "updated_at", "freshness", "source", "confidence"] as const;

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key)) && keys.every((key) => key in value);
}

/** Runtime-схема для API boundary и consumer fixtures. */
export function isFirmwarePilotStatus(value: unknown): value is FirmwarePilotStatus {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const status = value as Record<string, unknown>;
  if (status.status === "no_data") return hasOnlyKeys(status, ["status"]);
  if (status.status !== "reported" || !hasOnlyKeys(status, REPORTED_STATUS_KEYS)) return false;

  const stage = status.stage;
  const confidence = status.confidence;
  return typeof status.updated_at === "string"
    && /^20\d{2}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(status.updated_at)
    && typeof stage === "string"
    && (FIRMWARE_PILOT_STAGES as readonly string[]).includes(stage)
    && (status.freshness === "fresh" || status.freshness === "stale")
    && typeof status.source === "string"
    && (FIRMWARE_PILOT_SOURCES as readonly string[]).includes(status.source)
    && typeof confidence === "string"
    && (FIRMWARE_PILOT_CONFIDENCE as readonly string[]).includes(confidence)
    && (stage !== "ready" || confidence === "verified");
}

/** Аддитивное поле публичного DTO модели из `GET /printers/:slug`. */
export interface PrinterModelPilotStatusFields {
  /**
   * В переходный период старый producer может не прислать поле; consumer трактует
   * отсутствие так же честно, как `{ status: "no_data" }`. После rollout поле обязательно.
   */
  pilot_status?: FirmwarePilotStatus;
}

/** Компактное событие наблюдаемости без LAN-данных, токенов и команд. */
export interface FirmwarePilotStatusUpdatedEvent {
  contract_version: typeof FIRMWARE_PILOT_CONTRACT_VERSION;
  model_id: string;
  pilot_status: FirmwarePilotStatus;
  observed_at: string;
}
