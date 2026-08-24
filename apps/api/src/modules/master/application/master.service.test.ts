import { describe, expect, it, vi } from "vitest";
import { UserId } from "../../_kernel/brandedIds.ts";
import type { ProfileMasterPort } from "../../profile/public/index.ts";
import { MasterService } from "./master.service.ts";

const USER_ID = UserId("11111111-1111-4111-8111-111111111111");

describe("MasterService", () => {
  it("merges a partial profile without clobbering existing fields", async () => {
    const updateMasterProfile = vi.fn().mockResolvedValue({
      id: USER_ID,
      isMaster: true,
      masterProfile: { headline: "Печать", description: null, city: "Казань", slogan: "Быстро" },
    });
    const profiles = {
      findMasterState: vi.fn().mockResolvedValue({
        id: USER_ID,
        isMaster: true,
        masterProfile: { headline: "Печать", description: null, city: "Казань", slogan: null },
      }),
      updateMasterProfile,
    } as unknown as ProfileMasterPort;
    const service = new MasterService(profiles);
    await expect(service.update(USER_ID, { slogan: "  Быстро  " })).resolves.toEqual({
      is_master: true,
      master_profile: { headline: "Печать", description: null, city: "Казань", slogan: "Быстро" },
    });
    expect(updateMasterProfile).toHaveBeenCalledWith(USER_ID, {
      headline: "Печать",
      description: null,
      city: "Казань",
      slogan: "Быстро",
    });
  });

  it("preserves 403 for a non-master and 400 for a typed field", async () => {
    const nonMaster = new MasterService({ findMasterState: vi.fn().mockResolvedValue({ id: USER_ID, isMaster: false }) } as unknown as ProfileMasterPort);
    await expect(nonMaster.update(USER_ID, { headline: "x" })).rejects.toMatchObject({ status: 403 });
    const master = new MasterService({ findMasterState: vi.fn().mockResolvedValue({ id: USER_ID, isMaster: true, masterProfile: null }) } as unknown as ProfileMasterPort);
    await expect(master.update(USER_ID, { headline: 123 })).rejects.toMatchObject({ status: 400 });
  });

  it("conceals invalid and non-master public identifiers as 404", async () => {
    const service = new MasterService({ findActiveMaster: vi.fn().mockResolvedValue(null) } as unknown as ProfileMasterPort);
    await expect(service.publicProfile("not-a-uuid")).rejects.toMatchObject({ status: 404 });
    await expect(service.publicProfile(USER_ID)).rejects.toMatchObject({ status: 404 });
  });
});
