import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { isUUID } from "class-validator";
import type { UserId } from "../../_kernel/brandedIds.ts";
import type { InventoryMaterialDescription, UserInventoryRecord } from "../domain/inventory.types.ts";
import { ProfileMaterialsRepository } from "../infrastructure/materials.repository.ts";
import { PROFILE_MATERIAL_CATALOG_PORT, type ProfileMaterialCatalogPort } from "./profile-inventory.ports.ts";

export interface InventoryWriteInput {
  readonly material_id?: string;
  readonly variant_id?: string | null;
  readonly note?: string;
}

@Injectable()
export class ProfileMaterialsService {
  constructor(
    @Inject(ProfileMaterialsRepository) private readonly repository: ProfileMaterialsRepository,
    @Inject(PROFILE_MATERIAL_CATALOG_PORT) private readonly catalog: ProfileMaterialCatalogPort,
  ) {}

  async list(userId: UserId): Promise<{
    readonly materials: readonly (UserInventoryRecord & InventoryMaterialDescription)[];
  }> {
    return { materials: await this.describe(await this.repository.list(userId)) };
  }

  async create(userId: UserId, input: InventoryWriteInput): Promise<{ readonly material: UserInventoryRecord }> {
    if (!input.material_id) throw new BadRequestException();
    if (!(await this.catalog.materialExists(input.material_id))) throw new BadRequestException();
    if (input.variant_id && !(await this.catalog.variantBelongsToMaterial(input.variant_id, input.material_id))) {
      throw new BadRequestException();
    }
    const note = input.note === undefined ? null : input.note.trim().slice(0, 500) || null;
    return { material: await this.repository.create(userId, input.material_id, input.variant_id ?? null, note) };
  }

  async update(userId: UserId, id: string, input: InventoryWriteInput): Promise<{ readonly material: UserInventoryRecord }> {
    const owner = isUUID(id) ? await this.repository.owner(id) : null;
    if (owner === null) throw new NotFoundException();
    if (owner.user_id !== userId) throw new ForbiddenException();
    if (input.variant_id !== undefined && input.variant_id !== null && !(await this.catalog.variantBelongsToMaterial(input.variant_id, owner.material_id)))
      throw new BadRequestException();
    const note = input.note === undefined ? undefined : input.note.trim().slice(0, 500) || null;
    if (input.variant_id === undefined && note === undefined) throw new BadRequestException();
    return { material: await this.repository.update(id, input.variant_id, note) };
  }

  async delete(userId: UserId, id: string): Promise<{ readonly ok: true }> {
    const owner = isUUID(id) ? await this.repository.owner(id) : null;
    if (owner === null) throw new NotFoundException();
    if (owner.user_id !== userId) throw new ForbiddenException();
    await this.repository.delete(id);
    return { ok: true };
  }

  private async describe(records: readonly UserInventoryRecord[]): Promise<readonly (UserInventoryRecord & InventoryMaterialDescription)[]> {
    const result = await Promise.all(
      records.map(async (record) => {
        const description = await this.catalog.describeMaterial(record.material_id, record.variant_id);
        return description === null ? null : { ...record, ...description };
      }),
    );
    return result.filter((value): value is UserInventoryRecord & InventoryMaterialDescription => value !== null);
  }
}
