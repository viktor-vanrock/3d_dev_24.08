import { describe, expect, it } from "vitest";
import { normalizeCommandResult } from "./command-result.ts";

describe("нормализованный результат команды Relay", () => {
  const createdAt = new Date("2026-07-15T12:00:00.000Z");
  const ackedAt = new Date("2026-07-15T12:00:01.000Z");

  it("не сворачивает transport lifecycle в queued", () => {
    expect(
      normalizeCommandResult({
        id: "command-1",
        correlation_id: "correlation-1",
        raw_status: "delivered",
        result: null,
        created_at: createdAt,
        acked_at: null,
      }),
    ).toMatchObject({ status: "delivered", code: null, message: null, timestamp: createdAt.toISOString() });
  });

  it("не превращает ACK в executed без authoritative state", () => {
    expect(
      normalizeCommandResult({
        id: "command-1",
        correlation_id: "correlation-1",
        raw_status: "acknowledged",
        result: { ok: true },
        created_at: createdAt,
        acked_at: ackedAt,
      }),
    ).toMatchObject({ status: "acknowledged", code: null, message: null, timestamp: ackedAt.toISOString() });
  });

  it("выдаёт executed только из явного authoritative state и скрывает raw message", () => {
    expect(
      normalizeCommandResult({
        id: "command-1",
        correlation_id: "correlation-1",
        raw_status: "executed",
        result: { ok: true, status: "executed", message: "secret payload" },
        created_at: createdAt,
        acked_at: ackedAt,
      }),
    ).toMatchObject({ status: "executed", code: null, message: null, timestamp: ackedAt.toISOString() });
  });

  it("отдаёт единый failed без legacy rejected alias и скрывает raw message", () => {
    expect(
      normalizeCommandResult({
        id: "command-1",
        correlation_id: "correlation-1",
        raw_status: "failed",
        result: { ok: false, error_code: "device_offline", message: "10.0.0.1 token=secret" },
        created_at: createdAt,
        acked_at: ackedAt,
      }),
    ).toMatchObject({ status: "failed", code: "device_offline", message: "Устройство не подключено." });

    expect(
      normalizeCommandResult({
        id: "command-2",
        correlation_id: "correlation-2",
        raw_status: "failed",
        result: { ok: false, error_code: "driver_error", message: "raw agent details" },
        created_at: createdAt,
        acked_at: ackedAt,
      }),
    ).toMatchObject({ status: "failed", code: "driver_error", message: "Драйвер устройства отклонил команду." });
  });
});
