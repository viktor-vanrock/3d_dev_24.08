import { ConflictException, Inject, Injectable, UnprocessableEntityException } from "@nestjs/common";
import type { Pool, PoolClient } from "pg";
import { DATABASE_POOL } from "../../../nest/database/database.constants.ts";
import type { UserId } from "../../_kernel/brandedIds.ts";
import type { MaterialAdminRecord, MaterialAdminRepository, MaterialMutationResult } from "../application/material-admin.service.ts";
import type { MaterialAdminCreateInput, MaterialAdminStatus, MaterialAdminUpdateInput } from "../domain/material.admin.ts";

type MaterialAdminRow = MaterialAdminRecord;

function isUniqueViolation(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("code" in error)) return false;
  return error.code === "23505";
}

function isForeignKeyViolation(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("code" in error)) return false;
  return error.code === "23503";
}

async function audit(client: PoolClient, actorId: UserId, action: string, targetId: string, details: Readonly<Record<string, unknown>>): Promise<void> {
  await client.query(
    `insert into audit_log(actor_user_id,action,target_type,target_id,details) values($1,$2,'material',$3,$4)`,
    [actorId, action, targetId, JSON.stringify(details)],
  );
}

@Injectable()
export class MaterialAdminPgRepository implements MaterialAdminRepository {
  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {}

  async options() {
    const [vendors, materialTypes] = await Promise.all([
      this.pool.query<{ id: string; name: string }>(`select id,name from vendors order by name,id`),
      this.pool.query<{ id: string; name: string }>(`select id,name from material_types order by name,id`),
    ]);
    return { vendors: vendors.rows, material_types: materialTypes.rows };
  }

  async list(input: { readonly query: string; readonly status: MaterialAdminStatus | null; readonly kind: string | null; readonly limit: number; readonly offset: number }) {
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (input.query !== "") {
      params.push(`%${input.query}%`);
      conditions.push(`(m.name ilike $${params.length} or m.slug ilike $${params.length} or v.name ilike $${params.length})`);
    }
    if (input.status !== null) {
      params.push(input.status);
      conditions.push(`m.status = $${params.length}`);
    }
    if (input.kind !== null) {
      params.push(input.kind);
      conditions.push(`m.kind = $${params.length}`);
    }
    const where = conditions.length === 0 ? "" : `where ${conditions.join(" and ")}`;
    const total = await this.pool.query<{ count: string }>(
      `select count(*) as count from materials m join vendors v on v.id=m.vendor_id ${where}`,
      params,
    );
    params.push(input.limit, input.offset);
    const rows = await this.pool.query<MaterialAdminRow>(
      `select m.id,m.kind,m.slug,m.name,m.vendor_id,v.name as vendor_name,m.material_type_id,
              mt.name as material_type_name,m.specs,m.status,m.version,m.updated_at
       from materials m join vendors v on v.id=m.vendor_id join material_types mt on mt.id=m.material_type_id
       ${where} order by m.updated_at desc,m.id limit $${params.length - 1} offset $${params.length}`,
      params,
    );
    return { items: rows.rows, total: Number(total.rows[0]?.count ?? 0) };
  }

  async create(actorId: UserId, input: MaterialAdminCreateInput) {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const result = await client.query<{ id: string; version: number }>(
        `insert into materials(kind,vendor_id,material_type_id,slug,name,specs,status,version)
         values($1,$2,$3,$4,$5,$6,'draft',1) returning id,version`,
        [input.kind, input.vendorId, input.materialTypeId, input.slug, input.name, JSON.stringify(input.specs)],
      );
      const row = result.rows[0];
      if (row === undefined) throw new Error("material insert returned no row");
      await audit(client, actorId, "material.created", row.id, { version: row.version });
      await client.query("commit");
      return row;
    } catch (error) {
      await client.query("rollback");
      if (isUniqueViolation(error)) throw new ConflictException();
      if (isForeignKeyViolation(error)) throw new UnprocessableEntityException();
      throw error;
    } finally {
      client.release();
    }
  }

  async find(id: string): Promise<MaterialAdminRow | null> {
    const result = await this.pool.query<MaterialAdminRow>(
      `select m.id,m.kind,m.slug,m.name,m.vendor_id,v.name as vendor_name,m.material_type_id,
              mt.name as material_type_name,m.specs,m.status,m.version,m.updated_at
       from materials m join vendors v on v.id=m.vendor_id join material_types mt on mt.id=m.material_type_id
       where m.id=$1`,
      [id],
    );
    return result.rows[0] ?? null;
  }

  async update(actorId: UserId, id: string, input: MaterialAdminUpdateInput): Promise<MaterialMutationResult> {
    const entries: readonly (readonly [string, unknown])[] = [
      ...(input.name === undefined ? [] : [["name", input.name] as const]),
      ...(input.kind === undefined ? [] : [["kind", input.kind] as const]),
      ...(input.vendorId === undefined ? [] : [["vendor_id", input.vendorId] as const]),
      ...(input.materialTypeId === undefined ? [] : [["material_type_id", input.materialTypeId] as const]),
      ...(input.specs === undefined ? [] : [["specs", JSON.stringify(input.specs)] as const]),
    ];
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const params: unknown[] = [id, input.version];
      const sets = entries.map(([column, value]) => {
        params.push(value);
        return `${column}=$${params.length}`;
      });
      const result = await client.query<{ id: string; version: number }>(
        `update materials set ${sets.length === 0 ? "updated_at=now()" : `${sets.join(",")},updated_at=now()`},version=version+1
         where id=$1 and version=$2 and status<>'archived' returning id,version`,
        params,
      );
      const row = result.rows[0];
      if (row === undefined) {
        const exists = await client.query(`select 1 from materials where id=$1`, [id]);
        await client.query("rollback");
        return exists.rowCount === 0 ? { kind: "not_found" } : { kind: "conflict" };
      }
      await audit(client, actorId, "material.updated", row.id, { from_version: input.version, version: row.version, fields: entries.map(([column]) => column) });
      await client.query("commit");
      return { kind: "updated", ...row };
    } catch (error) {
      await client.query("rollback");
      if (isUniqueViolation(error)) throw new ConflictException();
      if (isForeignKeyViolation(error)) throw new UnprocessableEntityException();
      throw error;
    } finally {
      client.release();
    }
  }

  async publish(actorId: UserId, id: string, version: number): Promise<MaterialMutationResult> {
    return this.transition(actorId, id, version, "published");
  }

  async archive(actorId: UserId, id: string, version: number): Promise<MaterialMutationResult> {
    return this.transition(actorId, id, version, "archived");
  }

  async restore(actorId: UserId, id: string, version: number): Promise<MaterialMutationResult> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const result = await client.query<{ id: string; version: number }>(
        `update materials set status='draft',archived_at=null,updated_at=now(),version=version+1
         where id=$1 and version=$2 and status='archived' returning id,version`,
        [id, version],
      );
      const row = result.rows[0];
      if (row === undefined) {
        const current = await client.query<{ version: number; status: MaterialAdminStatus }>(`select version,status from materials where id=$1`, [id]);
        await client.query("rollback");
        const currentRow = current.rows[0];
        if (currentRow === undefined) return { kind: "not_found" };
        if (currentRow.version !== version) return { kind: "conflict" };
        return { kind: "invalid_transition" };
      }
      await audit(client, actorId, "material.restored", row.id, { from_version: version, version: row.version });
      await client.query("commit");
      return { kind: "updated", ...row };
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  private async transition(actorId: UserId, id: string, version: number, target: "published" | "archived"): Promise<MaterialMutationResult> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const transition = target === "archived" ? "status='archived',archived_at=now()" : "status='published',archived_at=null";
      const result = await client.query<{ id: string; version: number }>(
        `update materials set ${transition},updated_at=now(),version=version+1
         where id=$1 and version=$2 and status<>$3 returning id,version`,
        [id, version, target],
      );
      const row = result.rows[0];
      if (row === undefined) {
        const current = await client.query<{ version: number; status: MaterialAdminStatus }>(`select version,status from materials where id=$1`, [id]);
        await client.query("rollback");
        const currentRow = current.rows[0];
        if (currentRow === undefined) return { kind: "not_found" };
        if (currentRow.version !== version) return { kind: "conflict" };
        return { kind: "invalid_transition" };
      }
      await audit(client, actorId, target === "archived" ? "material.archived" : "material.published", row.id, { from_version: version, version: row.version });
      await client.query("commit");
      return { kind: "updated", ...row };
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }
}
