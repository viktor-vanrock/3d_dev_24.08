import { Inject, Injectable } from "@nestjs/common";
import type { Pool } from "pg";
import { DATABASE_POOL } from "../../../nest/database/database.constants.ts";
import type {
  CatalogMaterialDescription,
  CatalogJsonObject,
  CatalogPublicMaterial,
  CatalogMachineSummary,
  CatalogReadPort,
  CompatibilityMaterialRecord,
  SlicerFilamentRecord,
  SlicerMachineRecord,
} from "../public/index.ts";
import { RELEASE_EVENT_DATE_SQL, UUID_RE } from "../domain/catalog.ts";

export interface CatalogReleaseRow {
  readonly id: string;
  readonly machine_id: string | null;
  readonly vendor_id: string | null;
  readonly model_name: string;
  readonly status: string;
  readonly announced_at: string | null;
  readonly preorder_at: string | null;
  readonly ship_at: string | null;
  readonly eol_at: string | null;
  readonly source_url: string | null;
  readonly event_date: string;
}

export interface CatalogMaterialRow {
  readonly id: string;
  readonly craft: string;
  readonly kind: string;
  readonly slug: string;
  readonly name: string;
  readonly specs: CatalogJsonObject;
  readonly created_at: Date;
  readonly updated_at: Date;
  readonly vendor_id: string;
  readonly vendor_slug: string;
  readonly vendor_name: string;
  readonly material_type_id: string;
  readonly material_type_slug: string;
  readonly material_type_name: string;
}

export interface CatalogMaterialVariantRow {
  readonly id: string;
  readonly color_name: string;
  readonly color_hex: string | null;
  readonly diameter_mm: string;
  readonly weight_g: number | null;
  readonly spool_type: string | null;
  readonly sku: string | null;
  readonly specs: CatalogJsonObject;
  readonly created_at: Date;
}

export interface CatalogVendorRow {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly verified: boolean;
}

export interface CatalogMachineRow {
  readonly id: string;
  readonly craft: string;
  readonly kind: string;
  readonly vendor_id: string | null;
  readonly vendor_slug: string | null;
  readonly vendor_name: string | null;
  readonly model: string;
  readonly aliases: readonly string[];
  readonly year: number | null;
  readonly discontinued: boolean;
  readonly specs: CatalogJsonObject;
  readonly integration: string;
  readonly source: string;
  readonly verified: boolean;
}

export interface CatalogMetricsRow {
  readonly total_models: string;
  readonly complete_count: string;
  readonly verified_count: string;
  readonly median_freshness_days: number | null;
}

const MATERIAL_SELECT = `select m.id, m.craft, m.kind, m.slug, m.name, m.specs, m.created_at, m.updated_at,
         v.id as vendor_id, v.slug as vendor_slug, v.name as vendor_name,
         mt.id as material_type_id, mt.slug as material_type_slug, mt.name as material_type_name
  from materials m
  join vendors v on v.id = m.vendor_id
  join material_types mt on mt.id = m.material_type_id`;

const MACHINE_SELECT = `select m.id, m.craft, m.kind, m.vendor_id, v.slug as vendor_slug, v.name as vendor_name,
       m.model, m.aliases, m.year, m.discontinued, m.specs, m.integration, m.source, m.verified
  from machines m
  left join vendors v on v.id = m.vendor_id`;

@Injectable()
export class CatalogReadRepository implements CatalogReadPort {
  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {}

  async machineForSlicer(id: string): Promise<SlicerMachineRecord | null> {
    const result = await this.pool.query<SlicerMachineRecord>(`select id, specs from machines where id = $1 and status = 'active'`, [id]);
    return result.rows[0] ?? null;
  }

  async machineSummary(id: string): Promise<CatalogMachineSummary | null> {
    return (await this.pool.query<CatalogMachineSummary>(`select id, kind, vendor_id, model, specs from machines where id = $1`, [id])).rows[0] ?? null;
  }

  async filamentForSlicer(id: string): Promise<SlicerFilamentRecord | null> {
    const result = await this.pool.query<{ id: string; material_class: string; specs: CatalogJsonObject }>(
      `select m.id, mt.slug as material_class, m.specs
         from materials m
         join material_types mt on mt.id = m.material_type_id
        where m.id = $1 and m.kind = 'filament'`,
      [id],
    );
    const row = result.rows[0];
    return row === undefined ? null : { id: row.id, materialClass: row.material_class, specs: row.specs };
  }

  async machineExists(id: string): Promise<boolean> {
    return (await this.pool.query(`select 1 from machines where id = $1`, [id])).rowCount !== 0;
  }

  async vendorExists(id: string): Promise<boolean> {
    return (await this.pool.query(`select 1 from vendors where id = $1`, [id])).rowCount !== 0;
  }

  async machineVendorId(id: string): Promise<string | null> {
    return (await this.pool.query<{ vendor_id: string | null }>(`select vendor_id from machines where id = $1`, [id])).rows[0]?.vendor_id ?? null;
  }

  async machineIdsForVendor(vendorId: string): Promise<readonly string[]> {
    return (await this.pool.query<{ id: string }>(`select id from machines where vendor_id = $1`, [vendorId])).rows.map((row) => row.id);
  }

  async filamentExists(id: string): Promise<boolean> {
    return (await this.pool.query(`select 1 from materials where id = $1 and kind = 'filament'`, [id])).rowCount !== 0;
  }

  async materialExists(id: string): Promise<boolean> {
    return (await this.pool.query(`select 1 from materials where id = $1`, [id])).rowCount !== 0;
  }

  async publicMaterial(id: string): Promise<CatalogPublicMaterial | null> {
    const row = (
      await this.pool.query<{
        id: string;
        slug: string;
        name: string;
        vendor_id: string;
        vendor_slug: string;
        vendor_name: string;
      }>(
        `select m.id, m.slug, m.name, v.id as vendor_id, v.slug as vendor_slug, v.name as vendor_name
         from materials m join vendors v on v.id = m.vendor_id where m.id = $1`,
        [id],
      )
    ).rows[0];
    return row === undefined
      ? null
      : {
          id: row.id,
          slug: row.slug,
          name: row.name,
          vendor: { id: row.vendor_id, slug: row.vendor_slug, name: row.vendor_name },
        };
  }

  async materialsExist(ids: readonly string[]): Promise<boolean> {
    if (ids.length === 0) return true;
    const result = await this.pool.query<{ count: string }>(`select count(distinct id) as count from materials where id = any($1::uuid[])`, [ids]);
    return Number(result.rows[0]?.count ?? 0) === new Set(ids).size;
  }

  async variantBelongsToMaterial(variantId: string, materialId: string): Promise<boolean> {
    return (await this.pool.query(`select 1 from material_variants where id = $1 and material_id = $2`, [variantId, materialId])).rowCount !== 0;
  }

  async describeMaterial(materialId: string, variantId: string | null): Promise<CatalogMaterialDescription | null> {
    const result = await this.pool.query<CatalogMaterialDescription>(
      `select mat.name, v.name as brand, mt.slug as material_type,
              mv.color_name, mv.color_hex
       from materials mat
       join vendors v on v.id = mat.vendor_id
       join material_types mt on mt.id = mat.material_type_id
       left join material_variants mv on mv.id = $2 and mv.material_id = mat.id
       where mat.id = $1`,
      [materialId, variantId],
    );
    return result.rows[0] ?? null;
  }

  async compatibilityMaterial(materialId: string): Promise<CompatibilityMaterialRecord | null> {
    const result = await this.pool.query<{
      material_type: string;
      specs: CatalogJsonObject;
      default_extruder_temp_c: number | null;
      requires_chamber: boolean;
      requires_drying: boolean;
      requires_direct_drive: boolean;
    }>(
      `select mt.slug as material_type, mat.specs, mt.default_extruder_temp_c,
              mt.requires_chamber, mt.requires_drying, mt.requires_direct_drive
         from materials mat
         join material_types mt on mt.id = mat.material_type_id
        where mat.id = $1`,
      [materialId],
    );
    const row = result.rows[0];
    return row === undefined
      ? null
      : {
          materialType: row.material_type,
          specs: row.specs,
          defaultExtruderTempC: row.default_extruder_temp_c,
          requiresChamber: row.requires_chamber,
          requiresDrying: row.requires_drying,
          requiresDirectDrive: row.requires_direct_drive,
        };
  }

  async vendorWebsites(ids: readonly string[]): Promise<ReadonlyMap<string, string | null>> {
    if (ids.length === 0) return new Map();
    const rows = (await this.pool.query<{ id: string; website: string | null }>(`select id,website from vendors where id=any($1::uuid[])`, [ids])).rows;
    return new Map(rows.map((row) => [row.id, row.website]));
  }

  async machineVendorWebsites(ids: readonly string[]): Promise<ReadonlyMap<string, string | null>> {
    if (ids.length === 0) return new Map();
    const rows = (
      await this.pool.query<{ id: string; website: string | null }>(`select m.id,v.website from machines m join vendors v on v.id=m.vendor_id where m.id=any($1::uuid[])`, [ids])
    ).rows;
    return new Map(rows.map((row) => [row.id, row.website]));
  }

  async releases(input: {
    readonly statuses: readonly string[];
    readonly from: string | null;
    readonly to: string | null;
    readonly cursor: readonly [string, string] | null;
    readonly limit: number;
  }): Promise<readonly CatalogReleaseRow[]> {
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (input.statuses.length > 0) {
      params.push(input.statuses);
      conditions.push(`re.status = any($${params.length}::text[])`);
    }
    if (input.from !== null) {
      params.push(input.from);
      conditions.push(`${RELEASE_EVENT_DATE_SQL} >= $${params.length}::date`);
    }
    if (input.to !== null) {
      params.push(input.to);
      conditions.push(`${RELEASE_EVENT_DATE_SQL} <= $${params.length}::date`);
    }
    if (input.cursor !== null) {
      params.push(input.cursor[0], input.cursor[1]);
      conditions.push(`(${RELEASE_EVENT_DATE_SQL}, re.id) > ($${params.length - 1}::date, $${params.length}::uuid)`);
    }
    params.push(input.limit + 1);
    return (
      await this.pool.query<CatalogReleaseRow>(
        `select re.id, re.machine_id, re.vendor_id, re.model_name, re.status,
              re.announced_at::text, re.preorder_at::text, re.ship_at::text, re.eol_at::text, re.source_url,
              ${RELEASE_EVENT_DATE_SQL}::text as event_date
         from release_events re
         ${conditions.length > 0 ? `where ${conditions.join(" and ")}` : ""}
        order by ${RELEASE_EVENT_DATE_SQL} asc, re.id asc
        limit $${params.length}`,
        params,
      )
    ).rows;
  }

  async materials(input: {
    readonly vendor: string;
    readonly type: string;
    readonly kind: string | null;
    readonly color: string;
    readonly query: string;
    readonly limit: number;
    readonly offset: number;
  }): Promise<{ readonly rows: readonly CatalogMaterialRow[]; readonly total: number }> {
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (input.vendor) {
      params.push(input.vendor);
      conditions.push(UUID_RE.test(input.vendor) ? `v.id = $${params.length}::uuid` : `v.slug = $${params.length}`);
    }
    if (input.type) {
      params.push(input.type);
      conditions.push(`mt.slug = $${params.length}`);
    }
    if (input.kind !== null) {
      params.push(input.kind);
      conditions.push(`m.kind = $${params.length}`);
    }
    if (input.color) {
      params.push(`%${input.color}%`);
      conditions.push(`exists (select 1 from material_variants mv where mv.material_id = m.id and mv.color_name ilike $${params.length})`);
    }
    if (input.query) {
      params.push(`%${input.query}%`);
      const index = params.length;
      conditions.push(`(
        m.name ilike $${index} or v.name ilike $${index} or v.slug ilike $${index}
        or mt.name ilike $${index} or mt.slug ilike $${index} or m.kind::text ilike $${index}
        or exists (select 1 from material_variants mv where mv.material_id = m.id and mv.color_name ilike $${index})
      )`);
    }
    const where = conditions.length > 0 ? `where ${conditions.join(" and ")}` : "";
    const totalResult = await this.pool.query<{ total: string }>(
      `select count(*)::int as total from materials m
       join vendors v on v.id = m.vendor_id
       join material_types mt on mt.id = m.material_type_id ${where}`,
      params,
    );
    params.push(input.limit + 1, input.offset);
    const result = await this.pool.query<CatalogMaterialRow>(`${MATERIAL_SELECT} ${where} order by m.name, m.id limit $${params.length - 1} offset $${params.length}`, params);
    return { rows: result.rows, total: Number(totalResult.rows[0]?.total ?? 0) };
  }

  async material(id: string): Promise<CatalogMaterialRow | null> {
    return (await this.pool.query<CatalogMaterialRow>(`${MATERIAL_SELECT} where m.id = $1`, [id])).rows[0] ?? null;
  }

  async materialVariants(id: string): Promise<readonly CatalogMaterialVariantRow[]> {
    return (
      await this.pool.query<CatalogMaterialVariantRow>(
        `select id, color_name, color_hex, diameter_mm, weight_g, spool_type, sku, specs, created_at
         from material_variants where material_id = $1 order by color_name, diameter_mm`,
        [id],
      )
    ).rows;
  }

  async vendors(): Promise<readonly CatalogVendorRow[]> {
    return (await this.pool.query<CatalogVendorRow>(`select id, slug, name, verified from vendors order by name`)).rows;
  }

  async machines(input: {
    readonly vendor: string;
    readonly kind: string;
    readonly integration: string;
    readonly query: string;
    readonly limit: number;
    readonly offset: number;
  }): Promise<readonly CatalogMachineRow[]> {
    const conditions = ["m.status = 'active'"];
    const params: unknown[] = [];
    if (input.vendor) {
      params.push(input.vendor);
      conditions.push(UUID_RE.test(input.vendor) ? `m.vendor_id = $${params.length}` : `v.slug = $${params.length}`);
    }
    if (input.kind) {
      params.push(input.kind);
      conditions.push(`m.kind = $${params.length}`);
    }
    if (input.integration) {
      params.push(input.integration);
      conditions.push(`m.integration = $${params.length}`);
    }
    if (input.query) {
      params.push(`%${input.query}%`);
      conditions.push(`(m.model ilike $${params.length} or exists (select 1 from unnest(m.aliases) alias where alias ilike $${params.length}))`);
    }
    params.push(input.limit + 1, input.offset);
    return (
      await this.pool.query<CatalogMachineRow>(
        `${MACHINE_SELECT} where ${conditions.join(" and ")} order by m.model, m.id
       limit $${params.length - 1} offset $${params.length}`,
        params,
      )
    ).rows;
  }

  async machine(id: string): Promise<CatalogMachineRow | null> {
    return (await this.pool.query<CatalogMachineRow>(`${MACHINE_SELECT} where m.id = $1 and m.status = 'active'`, [id])).rows[0] ?? null;
  }

  async metrics(): Promise<CatalogMetricsRow> {
    const result = await this.pool.query<CatalogMetricsRow>(
      `with active as (
         select id, specs, verified, field_provenance, updated_at from machines where status = 'active'
       ), freshness as (
         select a.id, extract(epoch from (now() - coalesce(
           (select min((v.value->>'ts')::timestamptz) from jsonb_each(a.field_provenance) v), a.updated_at
         ))) / 86400 as freshness_days from active a
       )
       select (select count(*) from active) as total_models,
              (select count(*) from active where specs ?& $1::text[]) as complete_count,
              (select count(*) from active where verified) as verified_count,
              (select percentile_cont(0.5) within group (order by freshness_days) from freshness) as median_freshness_days`,
      [["build_volume", "kinematics", "nozzle_diameters", "materials_supported"]],
    );
    return result.rows[0]!;
  }
}
