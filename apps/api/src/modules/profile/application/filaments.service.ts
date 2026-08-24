import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { isUUID } from "class-validator";
import type { UserId } from "../../_kernel/brandedIds.ts";
import type { InventoryMaterialDescription, UserInventoryRecord } from "../domain/inventory.types.ts";
import { ProfileFilamentsRepository } from "../infrastructure/filaments.repository.ts";
import { PROFILE_MATERIAL_CATALOG_PORT, type ProfileMaterialCatalogPort } from "./profile-inventory.ports.ts";
import type { InventoryWriteInput } from "./materials.service.ts";

@Injectable()
export class ProfileFilamentsService {
  constructor(
    @Inject(ProfileFilamentsRepository) private readonly repository: ProfileFilamentsRepository,
    @Inject(PROFILE_MATERIAL_CATALOG_PORT) private readonly catalog: ProfileMaterialCatalogPort,
  ) {}

  async list(userId: UserId): Promise<{
    readonly filaments: readonly (UserInventoryRecord & InventoryMaterialDescription)[];
  }> {
    const records = await this.repository.list(userId);
    const result = await Promise.all(
      records.map(async (record) => {
        const description = await this.catalog.describeMaterial(record.material_id, record.variant_id);
        return description === null ? null : { ...record, ...description };
      }),
    );
    return {
      filaments: result.filter((value): value is UserInventoryRecord & InventoryMaterialDescription => value !== null),
    };
  }

  async create(userId: UserId, input: InventoryWriteInput): Promise<{ readonly filament: UserInventoryRecord }> {
    if (!input.material_id) throw new BadRequestException();
    if (!(await this.catalog.materialExists(input.material_id))) throw new NotFoundException();
    return { filament: await this.repository.create(userId, input.material_id) };
  }

  async update(userId: UserId, id: string, input: InventoryWriteInput): Promise<{ readonly filament: UserInventoryRecord }> {
    const owner = isUUID(id) ? await this.repository.owner(id) : null;
    if (owner === null) throw new NotFoundException();
    if (owner.user_id !== userId) throw new ForbiddenException();
    if (input.variant_id !== undefined && input.variant_id !== null && !(await this.catalog.variantBelongsToMaterial(input.variant_id, owner.material_id)))
      throw new BadRequestException();
    const note = input.note === undefined ? undefined : input.note.trim().slice(0, 500) || null;
    if (input.variant_id === undefined && note === undefined) throw new BadRequestException();
    return { filament: await this.repository.update(id, input.variant_id, note) };
  }

  async delete(userId: UserId, id: string): Promise<{ readonly ok: true }> {
    if (!isUUID(id)) throw new NotFoundException();
    await this.repository.deleteOwned(id, userId);
    return { ok: true };
  }
}
