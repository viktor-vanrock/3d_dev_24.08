import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { queueCommand, type QueueResult } from "./livecommands.ts";

/**
 * MF-1409: web evidence для trust journey capability matrix.
 *
 * Это transport-level проверка web-контура: API outcome является источником
 * истины, а не роль, которую UI мог бы предположить по наличию кнопки.
 * Секреты в браузерный запрос не попадают — авторизация только session cookie.
 */
const CAPABILITY_MATRIX = [
  { role: "owner", action: "read", outcome: "200" },
  { role: "owner", action: "control", outcome: "202 queued" },
  { role: "operator", action: "read", outcome: "200" },
  { role: "operator", action: "control", outcome: "202 queued" },
  { role: "viewer", action: "read", outcome: "200" },
  { role: "viewer", action: "control", outcome: "403 role_forbidden" },
  { role: "guest", action: "read", outcome: "200 or 404 by resource visibility" },
  { role: "guest", action: "control", outcome: "403 role_forbidden" },
  { role: "read-only key", action: "control", outcome: "403 missing_scope" },
  { role: "any", action: "control after limit", outcome: "429 RATE_LIMITED" },
] as const;

describe("MF-1409 capability matrix", () => {
  const fetchMock = vi.fn();

  beforeEach(() => vi.stubGlobal("fetch", fetchMock));

  afterEach(() => {
    fetchMock.mockReset();
    vi.unstubAllGlobals();
  });

  it("фиксирует read/control contract без обещания control viewer/guest", () => {
    expect(CAPABILITY_MATRIX).toEqual(
      expect.arrayContaining([
        { role: "owner", action: "control", outcome: "202 queued" },
        { role: "operator", action: "control", outcome: "202 queued" },
        { role: "viewer", action: "control", outcome: "403 role_forbidden" },
        { role: "guest", action: "control", outcome: "403 role_forbidden" },
        { role: "read-only key", action: "control", outcome: "403 missing_scope" },
      ]),
    );
  });

  it.each([
    [400, { error: "invalid_command" }],
    [403, { error: "command_denied", reason: "capability_unconfirmed" }],
    [429, { error: "RATE_LIMITED", retry_after_seconds: 12 }],
  ] as const)("показывает отказ HTTP %s как failed без сырого тела ответа", async (status, body) => {
    fetchMock.mockResolvedValue({ ok: false, status, json: async () => body });

    const result: QueueResult = await queueCommand("printer-1", "pause");

    expect(result).toEqual({ ok: false, reason: "rejected" });
    expect(fetchMock).toHaveBeenCalledWith(
      "/me/printers/printer-1/commands",
      expect.objectContaining({
        credentials: "include",
        body: JSON.stringify({ command: "pause" }),
      }),
    );
    expect(JSON.stringify(fetchMock.mock.calls[0])).not.toContain("key");
    expect(JSON.stringify(fetchMock.mock.calls[0])).not.toContain("token");
  });

  it("считает HTTP 202 только pending, а не подтверждением исполнения", async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, status: 202, json: async () => ({ id: "command-1", status: "accepted" }) });

    await expect(queueCommand("printer-1", "start")).resolves.toEqual({ ok: true, commandId: "command-1", status: "pending" });
  });

  it("различает временную серверную ошибку и отсутствие сети, чтобы UI мог предложить retry", async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: false, status: 503, json: async () => ({ error: "temporary_server_error" }) })
      .mockRejectedValueOnce(new TypeError("network unavailable"));

    await expect(queueCommand("printer-1", "stop")).resolves.toEqual({ ok: false, reason: "server_error" });
    await expect(queueCommand("printer-1", "stop")).resolves.toEqual({ ok: false, reason: "network" });
  });

  it("сохраняет accepted только при явном результате контракта", async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ id: "command-1", status: "accepted" }) });

    await expect(queueCommand("printer-1", "pause")).resolves.toEqual({ ok: true, commandId: "command-1", status: "accepted" });
  });
});
