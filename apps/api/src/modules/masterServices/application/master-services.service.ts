import { ForbiddenException, HttpException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { UserId } from "../../_kernel/brandedIds.ts";
import { CATALOG_READ_PORT, type CatalogReadPort } from "../../catalog/public/index.ts";
import {
  isDeliveryMethod,
  isPriceMode,
  isTechnology,
  isUuid,
  MAX_MATERIAL_IDS,
  optionalNonNegativeInt,
  parseLimit,
  parseOffset,
  rangeError,
  TITLE_MAX_LENGTH,
  toServiceJson,
  type MasterServiceWrite,
} from "../domain/master-services.ts";
import { MasterServicesRepository } from "../infrastructure/master-services.repository.ts";
import type { MasterServicesPort } from "../public/index.ts";

function fail(status: number): never {
  throw new HttpException({}, status);
}

function materialIds(raw: unknown, create: boolean): readonly string[] | undefined {
  if (raw === undefined) return create ? [] : undefined;
  if (!Array.isArray(raw)) fail(400);
  const values: readonly unknown[] = raw as readonly unknown[];
  const normalized = [...new Set(values.filter(isUuid))];
  if (normalized.length !== values.length || normalized.length > MAX_MATERIAL_IDS) fail(400);
  return normalized;
}

@Injectable()
export class MasterServicesService implements MasterServicesPort {
  constructor(
    @Inject(MasterServicesRepository) private readonly repository: MasterServicesRepository,
    @Inject(CATALOG_READ_PORT) private readonly catalog: CatalogReadPort,
  ) {}

  async create(masterId: UserId, body: Readonly<Record<string, unknown>>) {
    const title = typeof body.title === "string" ? body.title.trim() : "";
    if (!title || title.length > TITLE_MAX_LENGTH) fail(400);
    if (!isTechnology(body.technology)) fail(400);
    const priceMode = body.priceMode ?? "range";
    if (!isPriceMode(priceMode)) fail(400);
    const deliveryMethod = body.deliveryMethod ?? "any";
    if (!isDeliveryMethod(deliveryMethod)) fail(400);
    const priceMinMinor = optionalNonNegativeInt(body.priceMinMinor);
    const priceMaxMinor = optionalNonNegativeInt(body.priceMaxMinor);
    if (priceMinMinor === null || priceMaxMinor === null) fail(400);
    const minOrderAmountMinor = optionalNonNegativeInt(body.minOrderAmountMinor);
    if (minOrderAmountMinor === null) fail(400);
    const leadTimeDaysMin = optionalNonNegativeInt(body.leadTimeDaysMin);
    const leadTimeDaysMax = optionalNonNegativeInt(body.leadTimeDaysMax);
    if (leadTimeDaysMin === null || leadTimeDaysMax === null) fail(400);
    if (rangeError(priceMinMinor, priceMaxMinor, leadTimeDaysMin, leadTimeDaysMax)) fail(400);
    const minOrderQty = body.minOrderQty === undefined ? 1 : Number(body.minOrderQty);
    if (!Number.isInteger(minOrderQty) || minOrderQty < 1) fail(400);
    let machineId: string | null = null;
    if (body.machineId !== undefined && body.machineId !== null) {
      if (!isUuid(body.machineId)) fail(400);
      machineId = body.machineId;
    }
    const materials = materialIds(body.materialIds, true) ?? [];
    if (machineId !== null && !(await this.catalog.machineExists(machineId))) fail(422);
    if (!(await this.catalog.materialsExist(materials))) fail(422);
    const description = typeof body.description === "string" && body.description.trim() ? body.description.trim() : null;
    const deliveryZone = typeof body.deliveryZone === "string" && body.deliveryZone.trim() ? body.deliveryZone.trim() : null;
    const currency = typeof body.currency === "string" && body.currency ? body.currency : "RUB";
    const row = await this.repository.create(masterId, {
      title,
      description,
      technology: body.technology,
      machineId,
      priceMode,
      priceMinMinor: priceMinMinor ?? undefined,
      priceMaxMinor: priceMaxMinor ?? undefined,
      currency,
      minOrderQty,
      minOrderAmountMinor: minOrderAmountMinor ?? undefined,
      leadTimeDaysMin: leadTimeDaysMin ?? undefined,
      leadTimeDaysMax: leadTimeDaysMax ?? undefined,
      deliveryZone,
      deliveryMethod,
      materialIds: materials,
    });
    return toServiceJson(row, materials);
  }

  async update(masterId: UserId, serviceId: string, body: Readonly<Record<string, unknown>>) {
    const owner = await this.requireOwner(serviceId);
    if (owner !== masterId) throw new ForbiddenException();
    const input: { -readonly [K in keyof MasterServiceWrite]?: MasterServiceWrite[K] } = {};
    if (body.title !== undefined) {
      if (typeof body.title !== "string") fail(400);
      const title = body.title.trim();
      if (!title || title.length > TITLE_MAX_LENGTH) fail(400);
      input.title = title;
    }
    if (body.technology !== undefined) {
      if (!isTechnology(body.technology)) fail(400);
      input.technology = body.technology;
    }
    if (body.priceMode !== undefined) {
      if (!isPriceMode(body.priceMode)) fail(400);
      input.priceMode = body.priceMode;
    }
    if (body.deliveryMethod !== undefined) {
      if (!isDeliveryMethod(body.deliveryMethod)) fail(400);
      input.deliveryMethod = body.deliveryMethod;
    }
    const priceMinMinor = optionalNonNegativeInt(body.priceMinMinor);
    const priceMaxMinor = optionalNonNegativeInt(body.priceMaxMinor);
    if (priceMinMinor === null || priceMaxMinor === null) fail(400);
    const minOrderAmountMinor = optionalNonNegativeInt(body.minOrderAmountMinor);
    if (minOrderAmountMinor === null) fail(400);
    const leadTimeDaysMin = optionalNonNegativeInt(body.leadTimeDaysMin);
    const leadTimeDaysMax = optionalNonNegativeInt(body.leadTimeDaysMax);
    if (leadTimeDaysMin === null || leadTimeDaysMax === null) fail(400);
    const current = await this.repository.rangeState(serviceId);
    if (current === null) throw new NotFoundException();
    if (
      rangeError(
        priceMinMinor ?? (current.price_min_minor === null ? null : Number(current.price_min_minor)),
        priceMaxMinor ?? (current.price_max_minor === null ? null : Number(current.price_max_minor)),
        leadTimeDaysMin ?? current.lead_time_days_min,
        leadTimeDaysMax ?? current.lead_time_days_max,
      )
    )
      fail(400);
    if (priceMinMinor !== undefined) input.priceMinMinor = priceMinMinor;
    if (priceMaxMinor !== undefined) input.priceMaxMinor = priceMaxMinor;
    if (minOrderAmountMinor !== undefined) input.minOrderAmountMinor = minOrderAmountMinor;
    if (leadTimeDaysMin !== undefined) input.leadTimeDaysMin = leadTimeDaysMin;
    if (leadTimeDaysMax !== undefined) input.leadTimeDaysMax = leadTimeDaysMax;
    if (body.minOrderQty !== undefined) {
      const value = Number(body.minOrderQty);
      if (!Number.isInteger(value) || value < 1) fail(400);
      input.minOrderQty = value;
    }
    if (body.machineId !== undefined) {
      if (body.machineId === null) input.machineId = null;
      else {
        if (!isUuid(body.machineId)) fail(400);
        if (!(await this.catalog.machineExists(body.machineId))) fail(422);
        input.machineId = body.machineId;
      }
    }
    const materials = materialIds(body.materialIds, false);
    if (materials !== undefined) {
      if (!(await this.catalog.materialsExist(materials))) fail(422);
      input.materialIds = materials;
    }
    if (body.description !== undefined) {
      if (body.description !== null && typeof body.description !== "string") fail(400);
      input.description = body.description === null ? null : body.description.trim() || null;
    }
    if (body.deliveryZone !== undefined) {
      if (body.deliveryZone !== null && typeof body.deliveryZone !== "string") fail(400);
      input.deliveryZone = body.deliveryZone === null ? null : body.deliveryZone.trim() || null;
    }
    if (body.currency !== undefined) {
      if (typeof body.currency !== "string") fail(400);
      input.currency = body.currency;
    }
    const row = await this.repository.update(serviceId, input);
    const finalMaterials = materials ?? (await this.repository.materialIds(serviceId));
    return toServiceJson(row, finalMaterials);
  }

  async delete(masterId: UserId, serviceId: string) {
    const owner = await this.requireOwner(serviceId);
    if (owner !== masterId) throw new ForbiddenException();
    await this.repository.softDelete(serviceId);
    return { ok: true as const };
  }
  async detail(serviceId: string) {
    if (!isUuid(serviceId)) throw new NotFoundException();
    const row = await this.repository.active(serviceId);
    if (row === null) throw new NotFoundException();
    return toServiceJson(row, await this.repository.materialIds(row.id));
  }
  async list(masterId: string, query: Readonly<Record<string, unknown>>) {
    if (!isUuid(masterId)) throw new NotFoundException();
    const limit = parseLimit(query.limit);
    const offset = parseOffset(query.offset);
    const found = await this.repository.list(masterId, limit, offset);
    const hasMore = found.length > limit;
    const rows = hasMore ? found.slice(0, limit) : found;
    return { services: await Promise.all(rows.map(async (row) => toServiceJson(row, await this.repository.materialIds(row.id)))), limit, offset, has_more: hasMore };
  }

  private async requireOwner(id: string): Promise<string> {
    if (!isUuid(id)) throw new NotFoundException();
    const owner = await this.repository.activeOwner(id);
    if (owner === null) throw new NotFoundException();
    return owner;
  }
}
