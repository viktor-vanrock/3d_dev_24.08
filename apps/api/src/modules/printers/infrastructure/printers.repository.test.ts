import { describe, expect, it, vi } from "vitest";
import { UserId } from "../../_kernel/brandedIds.ts";
import { PrintersRepository } from "./printers.repository.ts";

describe("PrintersRepository owner port", () => {
  it("creates managed enrollment rows through the caller transaction", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ count: "0" }] })
      .mockResolvedValueOnce({ rows: [{ id: "device", user_id: "00000000-0000-4000-8000-000000000001", agent_id: "agent" }] });
    const repository = new PrintersRepository({ query: vi.fn() } as never);
    await expect(
      repository.createManagedDevice({ query } as never, {
        userId: UserId("00000000-0000-4000-8000-000000000001"),
        brand: "Prusa",
        model: "MK4",
        agentId: "agent",
        firmwareClass: "prusa",
      }),
    ).resolves.toMatchObject({ id: "device", agent_id: "agent" });
    expect(query).toHaveBeenCalledTimes(2);
    expect(String(query.mock.calls[1]?.[0])).toContain("insert into user_printers");
    expect(query.mock.calls[1]?.[1]).toContain("managed-bridge");
  });

  it("keeps compare-and-set agent linking atomic", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const repository = new PrintersRepository({ query } as never);
    await expect(repository.compareAndSetAgent("device", "old", "new")).resolves.toBeNull();
    expect(String(query.mock.calls[0]?.[0])).toContain("agent_id is not distinct from $2");
  });
});
