import { afterEach, describe, expect, it, vi } from "vitest";
import * as liveCommands from "./livecommands.ts";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("результат команды принтера", () => {
  it.each(["queued", "leased", "delivered", "acknowledged", "executed", "failed", "expired"] as const)("читает подтверждённый статус %s только из owner-scoped API", async (status) => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        command_id: "command-1",
        correlation_id: "correlation-1",
        device_id: "printer-1",
        command: "pause",
        status,
        code: status === "failed" ? "device_offline" : null,
        message: status === "failed" ? "Устройство не подключено." : null,
        timestamp: "2026-07-15T12:00:01.000Z",
      }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    const read = (liveCommands as Record<string, unknown>).fetchCommandResult;
    expect(read).toBeTypeOf("function");
    if (typeof read !== "function") return;

    const result = await (read as (printerId: string, commandId: string) => Promise<{ kind: string; correlationId: string | null }>)("printer-1", "command-1");

    expect(result).toMatchObject({ kind: status, correlationId: "correlation-1" });
    expect(fetchMock).toHaveBeenCalledWith(
      "/me/printers/printer-1/commands/command-1",
      expect.objectContaining({ credentials: "include" }),
    );
  });

  it("показывает offline/timeout как недоступность чтения, а не как успех очереди", async () => {
    const fetchMock = vi.fn(async () => ({ ok: false, status: 504 }));
    vi.stubGlobal("fetch", fetchMock);

    const read = (liveCommands as Record<string, unknown>).fetchCommandResult;
    expect(read).toBeTypeOf("function");
    if (typeof read !== "function") return;

    await expect((read as (printerId: string, commandId: string) => Promise<unknown>)("printer-1", "command-1")).resolves.toMatchObject({ kind: "offline" });
  });
});
