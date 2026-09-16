import { ConflictException, Inject, Injectable, NotFoundException, UnprocessableEntityException } from "@nestjs/common";
import type { UserId } from "../../_kernel/brandedIds.ts";
import { parseMaterialCreate, parseMaterialUpdate, type MaterialAdminCreateInput, type MaterialAdminKind, type MaterialAdminStatus, type MaterialAdminUpdateInput } from "../domain/material.admin.ts";
import type { CatalogJsonObject } from "../public/index.ts";

export interface MaterialAdminRecord {
  readonly id: string;
  readonly kind: MaterialAdminKind;
  readonly slug: string;
  readonly name: string;
  readonly vendor_id: string;
  readonly vendor_name: string;
  readonly material_type_id: string;
  readonly material_type_name: string;
  readonly specs: CatalogJsonObject;
  readonly status: MaterialAdminStatus;
  readonly version: number;
  readonly updated_at: Date;
}

export interface MaterialAdminListResult {
  readonly items: readonly MaterialAdminRecord[];
  readonly total: number;
  readonly limit: number;
  readonly offset: number;
  readonly has_more: boolean;
}

export interface MaterialAdminOption {
  readonly id: string;
  readonly name: string;
}

export interface MaterialAdminOptions {
  readonly vendors: readonly MaterialAdminOption[];
  readonly material_types: readonly MaterialAdminOption[];
}

export type MaterialMutationResult =
  | { readonly kind: "updated"; readonly id: string; readonly version: number }
  | { readonly kind: "conflict" }
  | { readonly kind: "invalid_transition" }
  | { readonly kind: "not_found" };

export interface MaterialAdminRepository {
  options(): Promise<MaterialAdminOptions>;
  list(input: { readonly query: string; readonly status: MaterialAdminStatus | null; readonly kind: string | null; readonly limit: number; readonly offset: number }): Promise<{ readonly items: readonly MaterialAdminRecord[]; readonly total: number }>;
  find(id: string): Promise<MaterialAdminRecord | null>;
  create(actorId: UserId, input: MaterialAdminCreateInput): Promise<{ readonly id: string; readonly version: number }>;
  update(actorId: UserId, id: string, input: MaterialAdminUpdateInput): Promise<MaterialMutationResult>;
  publish(actorId: UserId, id: string, version: number): Promise<MaterialMutationResult>;
  restore(actorId: UserId, id: string, version: number): Promise<MaterialMutationResult>;
  archive(actorId: UserId, id: string, version: number): Promise<MaterialMutationResult>;
}

export const MATERIAL_ADMIN_REPOSITORY = Symbol("MATERIAL_ADMIN_REPOSITORY");

function materialStatus(value: unknown): MaterialAdminStatus | null {
  if (value === "draft" || value === "published" || value === "archived") return value;
  return null;
}

@Injectable()
export class MaterialAdminService {
  constructor(@Inject(MATERIAL_ADMIN_REPOSITORY) private readonly repository: MaterialAdminRepository) {}

  options(): Promise<MaterialAdminOptions> {
    return this.repository.options();
  }

  list(query: { readonly q?: unknown; readonly kind?: unknown; readonly status?: unknown; readonly limit?: unknown; readonly offset?: unknown }): Promise<MaterialAdminListResult> {
    const limitValue = Number(query.limit);
    const offsetValue = Number(query.offset);
    const limit = Number.isInteger(limitValue) && limitValue > 0 ? Math.min(limitValue, 100) : 30;
    const offset = Number.isInteger(offsetValue) && offsetValue > 0 ? offsetValue : 0;
    const status = materialStatus(query.status);
    const kind = typeof query.kind === "string" && ["filament", "resin", "plywood", "aluminum"].includes(query.kind) ? query.kind : null;
    return this.repository.list({ query: typeof query.q === "string" ? query.q.trim().slice(0, 200) : "", status, kind, limit, offset })
      .then((result) => ({ ...result, limit, offset, has_more: offset + result.items.length < result.total }));
  }

  async create(actorId: UserId, body: unknown): Promise<{ readonly id: string; readonly version: number }> {
    const input = parseMaterialCreate(body);
    if (input === null) throw new UnprocessableEntityException();
    return this.repository.create(actorId, input);
  }

  async find(id: string): Promise<MaterialAdminRecord> {
    const material = await this.repository.find(id);
    if (material === null) throw new NotFoundException();
    return material;
  }

  async update(actorId: UserId, id: string, body: unknown): Promise<{ readonly id: string; readonly version: number }> {
    const input = parseMaterialUpdate(body);
    if (input === null) throw new UnprocessableEntityException();
    return this.unwrap(await this.repository.update(actorId, id, input));
  }

  async archive(actorId: UserId, id: string, version: unknown): Promise<{ readonly id: string; readonly version: number }> {
    if (typeof version !== "number" || !Number.isInteger(version) || version < 1) throw new UnprocessableEntityException();
    return this.unwrap(await this.repository.archive(actorId, id, version));
  }

  async publish(actorId: UserId, id: string, version: unknown): Promise<{ readonly id: string; readonly version: number }> {
    if (typeof version !== "number" || !Number.isInteger(version) || version < 1) throw new UnprocessableEntityException();
    return this.unwrap(await this.repository.publish(actorId, id, version));
  }

  async restore(actorId: UserId, id: string, version: unknown): Promise<{ readonly id: string; readonly version: number }> {
    if (typeof version !== "number" || !Number.isInteger(version) || version < 1) throw new UnprocessableEntityException();
    return this.unwrap(await this.repository.restore(actorId, id, version));
  }

  private unwrap(result: MaterialMutationResult): { readonly id: string; readonly version: number } {
    if (result.kind === "conflict" || result.kind === "invalid_transition") throw new ConflictException();
    if (result.kind === "not_found") throw new NotFoundException();
    return { id: result.id, version: result.version };
  }
}
