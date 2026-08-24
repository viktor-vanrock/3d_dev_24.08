import { FIRMWARE_PILOT_FRESH_FOR_HOURS, isFirmwarePilotStatus, type FirmwarePilotStatus } from "@portal/contracts/http/devices";

const FRESHNESS_WINDOW_MS = FIRMWARE_PILOT_FRESH_FOR_HOURS * 60 * 60 * 1000;

/**
 * Сериализует только подтверждённый Fleet-факт. Невалидные, неполные и старые
 * форматы не должны протекать в публичный DTO вместе с внутренними данными.
 */
export function serializePilotStatus(value: unknown, now = new Date()): FirmwarePilotStatus {
  if (!isFirmwarePilotStatus(value)) return { status: "no_data" };
  if (value.status === "no_data") return { status: "no_data" };

  const updatedAt = new Date(value.updated_at);
  if (!Number.isFinite(updatedAt.getTime()) || updatedAt.toISOString().replace(".000Z", "Z") !== value.updated_at) {
    return { status: "no_data" };
  }

  const reported = {
    status: "reported" as const,
    updated_at: value.updated_at,
    freshness: now.getTime() - updatedAt.getTime() > FRESHNESS_WINDOW_MS ? ("stale" as const) : ("fresh" as const),
    source: value.source,
  };
  if (value.stage === "ready") return { ...reported, stage: "ready" as const, confidence: "verified" as const };
  return { ...reported, stage: value.stage, confidence: value.confidence };
}
