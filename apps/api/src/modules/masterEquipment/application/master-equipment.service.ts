import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException, UnprocessableEntityException } from "@nestjs/common";
import type { UserId } from "../../_kernel/brandedIds.ts";
import { CATALOG_READ_PORT, type CatalogMachineSummary, type CatalogReadPort } from "../../catalog/public/index.ts";
import { PROFILE_MASTER_PORT, type ProfileMasterPort } from "../../profile/public/index.ts";
import { MAX_EQUIPMENT_MATERIAL_IDS, MAX_EQUIPMENT_QUANTITY, isMasterEquipmentStatus, type MasterEquipmentRecord, type MasterEquipmentStatus } from "../domain/master-equipment.ts";
import { MasterEquipmentRepository } from "../infrastructure/master-equipment.repository.ts";
import type { MasterEquipmentListResponse, MasterEquipmentPort, MasterEquipmentResponse } from "../public/index.ts";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function materialIds(value: unknown, optional: boolean): readonly string[] | null | undefined {
  if (value === undefined) return optional ? undefined : [];
  if (!Array.isArray(value)) return null;
  const ids = [...new Set(value.filter((item): item is string => typeof item === "string" && UUID_RE.test(item)))];
  return ids.length === value.length && ids.length <= MAX_EQUIPMENT_MATERIAL_IDS ? ids : null;
}

function limit(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(Math.floor(parsed), 100) : 24;
}

function offset(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
}

function response(row: MasterEquipmentRecord, ids: readonly string[], machine: CatalogMachineSummary | null) {
  return {
    id: row.id,
    master_id: row.master_id,
    machine_id: row.machine_id,
    machine,
    quantity: row.quantity,
    status: row.status,
    material_ids: ids,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

@Injectable()
export class MasterEquipmentService implements MasterEquipmentPort {
  constructor(
    @Inject(MasterEquipmentRepository) private readonly repository: MasterEquipmentRepository,
    @Inject(CATALOG_READ_PORT) private readonly catalog: CatalogReadPort,
    @Inject(PROFILE_MASTER_PORT) private readonly profiles: ProfileMasterPort,
  ) {}

  async create(userId: UserId, body: Record<string, unknown>): Promise<MasterEquipmentResponse> {
    const state = await this.profiles.findMasterState(userId);
    if (state?.isMaster !== true) throw new ForbiddenException();
    if (typeof body.machineId !== "string" || !UUID_RE.test(body.machineId)) throw new BadRequestException();
    const quantity = body.quantity === undefined ? 1 : Number(body.quantity);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_EQUIPMENT_QUANTITY) throw new BadRequestException();
    const status = body.status === undefined ? "unknown" : body.status;
    if (!isMasterEquipmentStatus(status)) throw new BadRequestException();
    const parsedIds = materialIds(body.materialIds, false);
    if (parsedIds === null) throw new BadRequestException();
    const ids = parsedIds ?? [];
    const machine = await this.catalog.machineSummary(body.machineId);
    if (machine === null) throw new UnprocessableEntityException();
    if (!(await this.catalog.materialsExist(ids))) throw new UnprocessableEntityException();
    try {
      const created = await this.repository.create({ masterId: userId, machineId: body.machineId, quantity, status, materialIds: ids });
      return response(created, ids, machine);
    } catch (error) {
      if ((error as { code?: string }).code === "23505") throw new ConflictException();
      throw error;
    }
  }

  async update(userId: UserId, id: string, body: Record<string, unknown>): Promise<MasterEquipmentResponse> {
    if (!UUID_RE.test(id)) throw new NotFoundException();
    const existing = await this.repository.findActive(id);
    if (existing === null) throw new NotFoundException();
    if (existing.master_id !== userId) throw new ForbiddenException();
    let quantity: number | undefined;
    if (body.quantity !== undefined) {
      quantity = Number(body.quantity);
      if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_EQUIPMENT_QUANTITY) throw new BadRequestException();
    }
    let status: MasterEquipmentStatus | undefined;
    if (body.status !== undefined) {
      if (!isMasterEquipmentStatus(body.status)) throw new BadRequestException();
      status = body.status;
    }
    const ids = materialIds(body.materialIds, true);
    if (ids === null) throw new BadRequestException();
    if (ids !== undefined && !(await this.catalog.materialsExist(ids))) throw new UnprocessableEntityException();
    const updated = await this.repository.update(id, quantity, status, ids);
    const finalIds = ids ?? (await this.repository.materialIds(id));
    return response(updated, finalIds, await this.catalog.machineSummary(updated.machine_id));
  }

  async delete(userId: UserId, id: string): Promise<{ readonly ok: true }> {
    if (!UUID_RE.test(id)) throw new NotFoundException();
    const existing = await this.repository.findActive(id);
    if (existing === null) throw new NotFoundException();
    if (existing.master_id !== userId) throw new ForbiddenException();
    await this.repository.softDelete(id);
    return { ok: true };
  }

  async list(masterId: string, query: Record<string, unknown>): Promise<MasterEquipmentListResponse> {
    if (!UUID_RE.test(masterId)) throw new NotFoundException();
    const pageLimit = limit(query.limit);
    const pageOffset = offset(query.offset);
    const rows = await this.repository.list(masterId, pageLimit, pageOffset);
    const hasMore = rows.length > pageLimit;
    const page = hasMore ? rows.slice(0, pageLimit) : rows;
    const equipment = await Promise.all(page.map(async (row) => response(row, await this.repository.materialIds(row.id), await this.catalog.machineSummary(row.machine_id))));
    return { equipment, limit: pageLimit, offset: pageOffset, has_more: hasMore };
  }
}
