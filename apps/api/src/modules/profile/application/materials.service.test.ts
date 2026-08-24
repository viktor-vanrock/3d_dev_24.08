import { describe, expect, it, vi } from "vitest";
import { UserId } from "../../_kernel/brandedIds.ts";
import type { ProfileMaterialsRepository } from "../infrastructure/materials.repository.ts";
import type { ProfileInventoryCatalogPort } from "./profile-inventory.ports.ts";
import { ProfileMaterialsService } from "./materials.service.ts";

const owner = UserId("00000000-0000-4000-8000-000000000001");
const foreign = UserId("00000000-0000-4000-8000-000000000002");

describe("ProfileMaterialsService", () => {
  it("validates catalog ownership through the port before inserting", async () => {
    const create = vi.fn().mockResolvedValue({ id: "record" });
    const repository = { create } as unknown as ProfileMaterialsRepository;
    const catalog = {
      materialExists: vi.fn().mockResolvedValue(true),
      variantBelongsToMaterial: vi.fn().mockResolvedValue(true),
    } as unknown as ProfileInventoryCatalogPort;
    const service = new ProfileMaterialsService(repository, catalog);

    await service.create(owner, { material_id: "material", variant_id: "variant", note: " note " });
    expect(create).toHaveBeenCalledWith(owner, "material", "variant", "note");
  });

  it("preserves 403 for a foreign inventory row", async () => {
    const repository = { owner: vi.fn().mockResolvedValue({ user_id: foreign, material_id: "material" }) } as unknown as ProfileMaterialsRepository;
    const service = new ProfileMaterialsService(repository, {} as ProfileInventoryCatalogPort);
    await expect(service.delete(owner, "00000000-0000-4000-8000-000000000003")).rejects.toMatchObject({ status: 403 });
  });
});
