import { ConflictException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { DevicesService } from "./devices.service.ts";

const PRINTER_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "22222222-2222-4222-8222-222222222222";
const COMMAND_ID = "33333333-3333-4333-8333-333333333333";
const CORRELATION_ID = "44444444-4444-4444-8444-444444444444";
const CREATED_AT = new Date("2026-08-10T10:00:00.000Z");

function setup(existing: Record<string, unknown> | null) {
  const inserted = existingCommand({ status: "delivered" });
  const repository = {
    access: vi.fn().mockResolvedValue({ role: "owner" }),
    commandContext: vi.fn().mockResolvedValue({ configFingerprint: null }),
    findProfileCommand: vi.fn().mockResolvedValue(existing),
    queueIdempotentCommand: vi.fn().mockResolvedValue({ row: inserted, conflict: false }),
  };
  const external = {
    commandPolicy: vi.fn().mockReturnValue({ allowed: true }),
    evaluatePublicCommand: vi.fn().mockReturnValue({ allowed: true }),
  };
  return {
    repository,
    service: new DevicesService(repository as never, external as never, {} as never),
  };
}

function existingCommand(overrides: Record<string, unknown> = {}) {
  return {
    id: COMMAND_ID,
    correlation_id: CORRELATION_ID,
    device_id: PRINTER_ID,
    command: "pause",
    payload: {},
    status: "acknowledged",
    result: null,
    created_at: CREATED_AT,
    acked_at: CREATED_AT,
    ...overrides,
  };
}

describe("DevicesService queueCommand receipt", () => {
  it("возвращает queued при replay уже подтверждённой команды", async () => {
    const { repository, service } = setup(existingCommand());

    await expect(service.queueCommand(PRINTER_ID, USER_ID as never, "same-key", { command: "pause" }, "request-id")).resolves.toEqual({
      id: COMMAND_ID,
      correlation_id: CORRELATION_ID,
      device_id: PRINTER_ID,
      command: "pause",
      status: "queued",
      created_at: CREATED_AT.toISOString(),
    });
    expect(repository.commandContext).not.toHaveBeenCalled();
    expect(repository.queueIdempotentCommand).not.toHaveBeenCalled();
  });

  it("возвращает queued для новой команды независимо от внутреннего статуса строки", async () => {
    const { service } = setup(null);

    await expect(service.queueCommand(PRINTER_ID, USER_ID as never, "new-key", { command: "pause" }, "request-id")).resolves.toMatchObject({
      id: COMMAND_ID,
      status: "queued",
    });
  });

  it("отклоняет replay с тем же ключом и другим payload", async () => {
    const { repository, service } = setup(existingCommand({ payload: { file_name: "first.gcode" } }));

    await expect(service.queueCommand(PRINTER_ID, USER_ID as never, "same-key", { command: "pause" }, "request-id")).rejects.toBeInstanceOf(ConflictException);
    expect(repository.commandContext).not.toHaveBeenCalled();
    expect(repository.queueIdempotentCommand).not.toHaveBeenCalled();
  });

  it("возвращает public replay до повторной проверки динамического состояния принтера", async () => {
    const { repository, service } = setup(existingCommand());

    await expect(service.publicCommand(USER_ID as never, PRINTER_ID, { command: "pause" }, "same-key", "request-id", true)).resolves.toEqual({
      status: 202,
      body: {
        id: COMMAND_ID,
        correlation_id: CORRELATION_ID,
        device_id: PRINTER_ID,
        command: "pause",
        status: "queued",
        created_at: CREATED_AT.toISOString(),
      },
    });
    expect(repository.commandContext).not.toHaveBeenCalled();
    expect(repository.queueIdempotentCommand).not.toHaveBeenCalled();
  });
});

describe("DevicesService relay revoke push", () => {
  it("pushes the revoked device-agent after its database revoke commits", async () => {
    const repository = { revokeDevice: vi.fn().mockResolvedValue({ kind: "ok", agentId: "agent-1" }) };
    const relayControl = { closeAgentSessions: vi.fn().mockResolvedValue(undefined) };
    const service = new DevicesService(repository as never, {} as never, {} as never, relayControl);

    await expect(service.revokeDevice(USER_ID as never, PRINTER_ID, "manual", "request-1")).resolves.toEqual({ ok: true });
    expect(relayControl.closeAgentSessions).toHaveBeenCalledWith(["agent-1"], "agent_revoked");
  });
});
