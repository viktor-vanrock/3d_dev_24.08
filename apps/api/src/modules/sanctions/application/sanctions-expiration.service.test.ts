import { describe, expect, it, vi } from "vitest";
import { SanctionId, UserId } from "../../_kernel/brandedIds.ts";
import { SanctionsExpirationService } from "./sanctions-expiration.service.ts";

const user = UserId("11111111-1111-4111-8111-111111111111"); const sanction = SanctionId("22222222-2222-4222-8222-222222222222");
function setup(due: readonly { id: ReturnType<typeof SanctionId>; userId: ReturnType<typeof UserId> }[], active = 0) {
  const tx = { query: vi.fn().mockResolvedValue(undefined), release: vi.fn() }; const pool = { connect: vi.fn().mockResolvedValue(tx) };
  const repository = { claimDueActiveSanctionsForUpdate: vi.fn().mockResolvedValue(due), markExpired: vi.fn().mockResolvedValue(true), countActiveSanctionsForUser: vi.fn().mockResolvedValue(active) };
  const profiles = { activateAfterSanctionExpiry: vi.fn().mockResolvedValue({ changed: true }) };
  return { tx, repository, profiles, service: new SanctionsExpirationService(pool as never, repository as never, profiles as never) };
}
describe("SanctionsExpirationService", () => {
  it("does nothing for an empty claim", async () => { const { service, repository, profiles } = setup([]); await expect(service.expireDue({ limit: 500, workerId: "worker" })).resolves.toEqual({ expired: 0, activatedUsers: 0 }); expect(repository.markExpired).not.toHaveBeenCalled(); expect(profiles.activateAfterSanctionExpiry).not.toHaveBeenCalled(); });
  it("expires and activates when no other active sanction remains", async () => { const { service, profiles } = setup([{ id: sanction, userId: user }]); await expect(service.expireDue({ limit: 500, workerId: "worker" })).resolves.toEqual({ expired: 1, activatedUsers: 1 }); expect(profiles.activateAfterSanctionExpiry).toHaveBeenCalled(); });
  it("leaves a user restricted when another active sanction exists", async () => { const { service, profiles } = setup([{ id: sanction, userId: user }], 1); await expect(service.expireDue({ limit: 500, workerId: "worker" })).resolves.toEqual({ expired: 1, activatedUsers: 0 }); expect(profiles.activateAfterSanctionExpiry).not.toHaveBeenCalled(); });
  it("rolls back the batch when repository work fails", async () => { const { service, tx, repository } = setup([{ id: sanction, userId: user }]); repository.markExpired.mockRejectedValueOnce(new Error("db")); await expect(service.expireDue({ limit: 500, workerId: "worker" })).rejects.toThrow("db"); expect(tx.query).toHaveBeenCalledWith("rollback"); });
});
