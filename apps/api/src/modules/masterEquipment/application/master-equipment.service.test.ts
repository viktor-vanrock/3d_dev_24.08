import { BadRequestException, ForbiddenException, NotFoundException, UnprocessableEntityException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { UserId } from "../../_kernel/brandedIds.ts";
import type { CatalogReadPort } from "../../catalog/public/index.ts";
import type { ProfileMasterPort } from "../../profile/public/index.ts";
import type { MasterEquipmentRepository } from "../infrastructure/master-equipment.repository.ts";
import { MasterEquipmentService } from "./master-equipment.service.ts";

const userId = UserId("11111111-1111-4111-8111-111111111111");
const machineId = "22222222-2222-4222-8222-222222222222";

function setup() {
  const repository = {
    create: vi.fn(),
    findActive: vi.fn().mockResolvedValue(null),
    materialIds: vi.fn(),
    update: vi.fn(),
    softDelete: vi.fn(),
    list: vi.fn().mockResolvedValue([]),
  } as unknown as MasterEquipmentRepository;
  const catalog = {
    machineSummary: vi.fn().mockResolvedValue({ id: machineId, kind: "fdm", vendor_id: null, model: "M", specs: {} }),
    materialsExist: vi.fn().mockResolvedValue(true),
  } as unknown as CatalogReadPort;
  const profiles = {
    findMasterState: vi.fn().mockResolvedValue({ id: userId, isMaster: true, masterProfile: null }),
  } as unknown as ProfileMasterPort;
  return { repository, catalog, profiles, service: new MasterEquipmentService(repository, catalog, profiles) };
}

describe("MasterEquipmentService legacy decisions", () => {
  it("keeps the master role gate at 403", async () => {
    const { service, profiles } = setup();
    vi.mocked(profiles.findMasterState).mockResolvedValue({ id: userId, isMaster: false, masterProfile: null });
    await expect(service.create(userId, { machineId })).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("keeps input errors at 400 and missing catalog references at 422", async () => {
    const { service, catalog } = setup();
    await expect(service.create(userId, { machineId: "bad" })).rejects.toBeInstanceOf(BadRequestException);
    vi.mocked(catalog.machineSummary).mockResolvedValue(null);
    await expect(service.create(userId, { machineId })).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it("conceals malformed and missing equipment with 404", async () => {
    const { service } = setup();
    await expect(service.delete(userId, "bad")).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.delete(userId, "33333333-3333-4333-8333-333333333333")).rejects.toBeInstanceOf(NotFoundException);
  });

  it("preserves catalog pagination defaults", async () => {
    const { service } = setup();
    await expect(service.list(userId, {})).resolves.toEqual({ equipment: [], limit: 24, offset: 0, has_more: false });
  });
});
