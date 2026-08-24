import { Inject, Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { parseMaterialCandidateRaw } from "./material-candidates.merge.ts";
import { compactModelName } from "./resolve/normalize.ts";
import { checkPlausibility } from "./resolve/plausibility.ts";
import { CLEAN_MERGE_CONFIDENCE, parseRaw } from "./resolve/run.ts";
import { mergeCandidateIntoMachine, type FieldProvenance, type Specs } from "./resolve/merge.ts";
import { resolveVendorName } from "./vendor-normalize.ts";
import { DATABASE_POOL } from "../../../nest/database/database.constants.ts";
import type { CatalogCandidateMutationResponse, CatalogJsonValue } from "../public/index.ts";

export interface CandidateRow {
  readonly id: string;
  readonly source: string;
  readonly source_url: string | null;
  readonly external_ref: string;
  readonly raw: CatalogJsonValue;
  readonly matched_material_id?: string | null;
  readonly matched_machine_id?: string | null;
  readonly confidence: string | null;
  readonly status: string;
  readonly created_at: Date;
  readonly updated_at: Date;
}

interface MachineRow {
  readonly id: string;
  readonly model: string;
  readonly aliases: string[];
  readonly specs: Specs;
  readonly field_provenance: FieldProvenance;
  readonly status: string;
}

export type CandidateMutation =
  | {
      readonly kind: "ok";
      readonly body: CatalogCandidateMutationResponse;
      readonly community?: { readonly vendorId: string; readonly vendorName: string; readonly machineId: string; readonly model: string };
    }
  | { readonly kind: "not_found" }
  | { readonly kind: "not_pending"; readonly status: string }
  | { readonly kind: "unmergeable"; readonly source: string }
  | { readonly kind: "matched_machine_missing" };

@Injectable()
export class CatalogCandidatesRepository {
  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {}

  async materialCandidates(status: string, limit: number, offset: number): Promise<readonly CandidateRow[]> {
    return (
      await this.pool.query<CandidateRow>(
        `select id, source, source_url, external_ref, raw, matched_material_id, confidence, status, created_at, updated_at
         from material_candidates where status = $1 order by created_at limit $2 offset $3`,
        [status, limit + 1, offset],
      )
    ).rows;
  }

  async machineCandidates(statuses: readonly string[], limit: number, offset: number): Promise<readonly CandidateRow[]> {
    return (
      await this.pool.query<CandidateRow>(
        `select id, source, source_url, external_ref, raw, matched_machine_id, confidence, status, created_at, updated_at
         from machine_candidates where status = any($1) order by created_at limit $2 offset $3`,
        [statuses, limit + 1, offset],
      )
    ).rows;
  }

  async candidateMachines(ids: readonly string[]): Promise<ReadonlyMap<string, MachineRow>> {
    if (ids.length === 0) return new Map();
    const rows = (await this.pool.query<MachineRow>(`select id, model, aliases, specs, field_provenance, status from machines where id = any($1)`, [ids])).rows;
    return new Map(rows.map((row) => [row.id, row]));
  }

  async createMaterialCandidate(userId: string, input: { vendor: string; materialType: string; colorName: string; notes: string | null }) {
    return (
      await this.pool.query<{ id: string; created_at: Date }>(
        `insert into material_candidates (source, external_ref, raw, status)
       values ('user_suggestion', $1, $2::jsonb, 'pending') returning id, created_at`,
        [randomUUID(), JSON.stringify({ vendor: input.vendor, material_type: input.materialType, color_name: input.colorName, notes: input.notes, suggested_by: userId })],
      )
    ).rows[0]!;
  }

  async createMachineCandidate(userId: string, input: { vendor: string; model: string; notes: string | null }) {
    return (
      await this.pool.query<{ id: string; created_at: Date }>(
        `insert into machine_candidates (source, external_ref, raw, status)
       values ('user_suggestion', $1, $2::jsonb, 'pending') returning id, created_at`,
        [randomUUID(), JSON.stringify({ vendor: input.vendor, model: input.model, specs: {}, notes: input.notes, suggested_by: userId })],
      )
    ).rows[0]!;
  }

  async approveMaterialCandidate(id: string): Promise<CandidateMutation> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const candidate = (
        await client.query<CandidateRow>(
          `select id, source, source_url, external_ref, raw, matched_material_id, confidence, status, created_at, updated_at
         from material_candidates where id = $1 for update`,
          [id],
        )
      ).rows[0];
      if (candidate === undefined) {
        await client.query("rollback");
        return { kind: "not_found" };
      }
      if (candidate.status !== "pending") {
        await client.query("rollback");
        return { kind: "not_pending", status: candidate.status };
      }
      const parsed = parseMaterialCandidateRaw(candidate.source, candidate.raw);
      if (parsed === null) {
        await client.query("rollback");
        return { kind: "unmergeable", source: candidate.source };
      }
      const vendorId = (
        await client.query<{ id: string }>(`insert into vendors (slug, name) values ($1, $2) on conflict (slug) do update set name = excluded.name returning id`, [
          parsed.vendorSlug,
          parsed.vendorName,
        ])
      ).rows[0]!.id;
      const insertedType = await client.query<{ id: string }>(`insert into material_types (slug, name) values ($1, $2) on conflict (slug) do nothing returning id`, [
        parsed.materialTypeSlug,
        parsed.materialTypeName,
      ]);
      const materialTypeId =
        insertedType.rows[0]?.id ?? (await client.query<{ id: string }>(`select id from material_types where slug = $1`, [parsed.materialTypeSlug])).rows[0]!.id;
      const materialId = (
        await client.query<{ id: string }>(
          `insert into materials (kind, vendor_id, material_type_id, slug, name, specs, source)
         values ('filament', $1, $2, $3, $4, $5::jsonb, 'import')
         on conflict (vendor_id, slug) do update set updated_at = now() returning id`,
          [vendorId, materialTypeId, parsed.materialSlug, parsed.materialName, JSON.stringify(parsed.materialSpecs)],
        )
      ).rows[0]!.id;
      const variantId = (
        await client.query<{ id: string }>(
          `insert into material_variants
           (material_id, color_name, color_hex, diameter_mm, weight_g, specs, source, confidence, external_ref)
         values ($1, $2, $3, $4, $5, $6::jsonb, 'import', $7, $8) returning id`,
          [
            materialId,
            parsed.colorName,
            parsed.colorHex,
            parsed.diameterMm,
            parsed.weightG,
            JSON.stringify(parsed.variantSpecs),
            candidate.confidence === null ? null : Number(candidate.confidence),
            candidate.external_ref,
          ],
        )
      ).rows[0]!.id;
      await client.query(`update material_candidates set status = 'merged', matched_material_id = $2, updated_at = now() where id = $1`, [id, materialId]);
      await client.query("commit");
      return { kind: "ok", body: { status: "merged", material_candidate_id: id, material_id: materialId, material_variant_id: variantId } };
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async approveMachineCandidate(id: string): Promise<CandidateMutation> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const candidate = (
        await client.query<CandidateRow>(
          `select id, source, source_url, external_ref, raw, matched_machine_id, confidence, status, created_at, updated_at
         from machine_candidates where id = $1 for update`,
          [id],
        )
      ).rows[0];
      if (candidate === undefined) {
        await client.query("rollback");
        return { kind: "not_found" };
      }
      if (candidate.status !== "pending" && candidate.status !== "quarantined") {
        await client.query("rollback");
        return { kind: "not_pending", status: candidate.status };
      }
      const parsed = parseRaw(candidate.raw);
      if (parsed === null) {
        await client.query("rollback");
        return { kind: "unmergeable", source: candidate.source };
      }
      let machineId: string;
      if (candidate.matched_machine_id) {
        const machine = (
          await client.query<MachineRow>(`select id, model, aliases, specs, field_provenance, status from machines where id = $1 for update`, [candidate.matched_machine_id])
        ).rows[0];
        if (machine === undefined) {
          await client.query("rollback");
          return { kind: "matched_machine_missing" };
        }
        const merge = mergeCandidateIntoMachine({
          existingSpecs: machine.specs,
          existingProvenance: machine.field_provenance,
          candidateSpecs: parsed.specs,
          candidateSource: candidate.source,
          candidateSourceUrl: candidate.source_url,
          candidateConfidence: candidate.confidence === null ? null : Number(candidate.confidence),
          now: new Date().toISOString(),
        });
        const aliases = [...machine.aliases];
        if (!new Set([machine.model, ...machine.aliases].map(compactModelName)).has(compactModelName(parsed.model))) aliases.push(parsed.model);
        const mergedSpecs = { ...merge.specs, ...Object.fromEntries(merge.conflicts.map((field) => [field, parsed.specs[field]])) };
        const status = checkPlausibility(mergedSpecs).plausible ? "active" : "quarantined";
        await client.query(`update machines set specs = $2::jsonb, field_provenance = $3::jsonb, aliases = $4, status = $5, updated_at = now() where id = $1`, [
          machine.id,
          JSON.stringify(mergedSpecs),
          JSON.stringify(merge.provenance),
          aliases,
          status,
        ]);
        machineId = machine.id;
      } else {
        const vendor = resolveVendorName(parsed.vendor);
        const vendorId = (
          await client.query<{ id: string }>(`insert into vendors (slug, name) values ($1, $2) on conflict (slug) do update set name = excluded.name returning id`, [
            vendor.slug,
            vendor.name,
          ])
        ).rows[0]!.id;
        const provenance: FieldProvenance = {};
        const now = new Date().toISOString();
        for (const field of Object.keys(parsed.specs))
          provenance[field] = {
            source: candidate.source,
            source_url: candidate.source_url,
            ts: now,
            confidence: candidate.confidence === null ? 0.5 : Number(candidate.confidence),
          };
        machineId = (
          await client.query<{ id: string }>(
            `insert into machines (craft, kind, vendor_id, model, specs, field_provenance, status, source)
           values ('3d_printing', 'fdm_printer', $1, $2, $3::jsonb, $4::jsonb, 'active', 'community') returning id`,
            [vendorId, parsed.model, JSON.stringify(parsed.specs), JSON.stringify(provenance)],
          )
        ).rows[0]!.id;
      }
      await client.query(`update machine_candidates set status = 'merged', matched_machine_id = $2, confidence = $3, updated_at = now() where id = $1`, [
        id,
        machineId,
        CLEAN_MERGE_CONFIDENCE,
      ]);
      await client.query("commit");
      const subject = (
        await this.pool.query<{ vendor_id: string; vendor_name: string; model: string }>(
          `select v.id as vendor_id, v.name as vendor_name, m.model from machines m join vendors v on v.id = m.vendor_id where m.id = $1`,
          [machineId],
        )
      ).rows[0];
      return {
        kind: "ok",
        body: { status: "merged", machine_candidate_id: id, machine_id: machineId },
        community: subject === undefined ? undefined : { vendorId: subject.vendor_id, vendorName: subject.vendor_name, machineId, model: subject.model },
      };
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async rejectCandidate(table: "material_candidates" | "machine_candidates", id: string, statuses: readonly string[]): Promise<CandidateMutation> {
    const updated = await this.pool.query<{ status: string }>(`update ${table} set status = 'rejected', updated_at = now() where id = $1 and status = any($2) returning status`, [
      id,
      statuses,
    ]);
    if (updated.rowCount !== 0) {
      return table === "material_candidates"
        ? { kind: "ok", body: { status: "rejected", material_candidate_id: id } }
        : { kind: "ok", body: { status: "rejected", machine_candidate_id: id } };
    }
    const existing = (await this.pool.query<{ status: string }>(`select status from ${table} where id = $1`, [id])).rows[0];
    return existing === undefined ? { kind: "not_found" } : { kind: "not_pending", status: existing.status };
  }
}
