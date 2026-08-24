import { Inject, Injectable } from "@nestjs/common";
import type { Pool } from "pg";
import { DATABASE_POOL } from "../../../nest/database/database.constants.ts";
import { ModelId, UserId } from "../../_kernel/brandedIds.ts";
import type { BillingModelSnapshot, ModelReadPort, PublicModelSeo, SitemapModel, SitemapOwnerActivity, ModelSliceDispatchResult } from "../public/index.ts";
import type { SliceTrustMaterial } from "@portal/contracts/jobs/slicer";
import { isDispatchableSliceJob } from "./slicing.route.ts";
import { modelBboxSizeMm } from "./bbox.ts";
import type { ModelId as ModelIdType, UserId as UserIdType } from "../../_kernel/brandedIds.ts";

@Injectable()
export class ModelReadRepository implements ModelReadPort {
  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {}

  async exists(modelId: ModelIdType): Promise<boolean> {
    return (await this.pool.query(`select 1 from projects where id = $1 and deleted_at is null`, [modelId])).rowCount !== 0;
  }

  async boundingBox(modelId: ModelIdType): Promise<{ readonly x: number; readonly y: number; readonly z: number } | null> {
    const result = await this.pool.query<{ bbox: unknown }>(
      `select r.bbox
         from projects p
         join models m on m.id = p.primary_model_id and m.project_id = p.id and m.deleted_at is null
         join model_revisions r on r.id = m.active_revision_id and r.model_id = m.id
        where p.id = $1 and p.deleted_at is null`,
      [modelId],
    );
    const bbox = result.rows[0]?.bbox;
    if (!bbox || typeof bbox !== "object") return null;
    const record = bbox as Record<string, unknown>;
    if (typeof record.x === "number" && typeof record.y === "number" && typeof record.z === "number") {
      return { x: record.x, y: record.y, z: record.z };
    }
    const size = record.size;
    if (!Array.isArray(size) || size.length !== 3 || !size.every((value) => typeof value === "number")) return null;
    const [x, y, z] = size as [number, number, number];
    return { x, y, z };
  }

  async findReadySeo(modelId: ModelIdType): Promise<PublicModelSeo | null> {
    const result = await this.pool.query<{
      id: string;
      owner_id: string;
      title: string;
      description: string | null;
      has_thumbnail: boolean;
    }>(
      `select p.id, p.owner_id,
              pr.metadata_snapshot ->> 'title' as title,
              pr.metadata_snapshot ->> 'description' as description,
              exists(
                select 1
                  from project_revision_models prm
                  join model_revision_files f on f.model_revision_id = prm.model_revision_id and f.role = 'thumbnail'
                  join storage_blobs b on b.id = f.blob_id and b.state = 'ready'
                 where prm.project_revision_id = pr.id
              ) as has_thumbnail
         from projects p
         join project_revisions pr on pr.id = p.published_revision_id and pr.project_id = p.id
        where p.id = $1 and p.deleted_at is null`,
      [modelId],
    );
    const row = result.rows[0];
    return row === undefined
      ? null
      : {
          id: ModelId(row.id),
          ownerId: UserId(row.owner_id),
          title: row.title,
          description: row.description,
          hasThumbnail: row.has_thumbnail,
        };
  }

  async readyThumbnailKey(modelId: ModelIdType): Promise<string | null> {
    const result = await this.pool.query<{ s3_key: string | null }>(
      `select b.s3_key
         from projects p
         join project_revisions pr on pr.id = p.published_revision_id and pr.project_id = p.id
         join project_revision_models prm on prm.project_revision_id = pr.id and prm.model_id = pr.primary_model_id
         join model_revision_files f on f.model_revision_id = prm.model_revision_id and f.role = 'thumbnail'
         join storage_blobs b on b.id = f.blob_id and b.state = 'ready'
        where p.id = $1 and p.deleted_at is null`,
      [modelId],
    );
    return result.rows[0]?.s3_key ?? null;
  }

  async readySitemapModels(): Promise<readonly SitemapModel[]> {
    const result = await this.pool.query<{ id: string; updated_at: Date }>(
      `select p.id, pr.created_at as updated_at
         from projects p join project_revisions pr on pr.id = p.published_revision_id and pr.project_id = p.id
        where p.deleted_at is null order by pr.created_at desc, p.id desc`,
    );
    return result.rows.map((row) => ({ id: ModelId(row.id), updatedAt: row.updated_at }));
  }

  async readySitemapOwners(): Promise<readonly SitemapOwnerActivity[]> {
    const result = await this.pool.query<{ owner_id: string; last_updated_at: Date }>(
      `select p.owner_id, max(pr.created_at) as last_updated_at
         from projects p join project_revisions pr on pr.id = p.published_revision_id and pr.project_id = p.id
        where p.deleted_at is null
        group by p.owner_id
        order by last_updated_at desc`,
    );
    return result.rows.map((row) => ({ ownerId: UserId(row.owner_id), lastUpdatedAt: row.last_updated_at }));
  }

  async countReadyByOwner(userId: UserIdType): Promise<number> {
    const result = await this.pool.query<{ count: string }>(
      `select count(*) as count from projects where owner_id = $1 and published_revision_id is not null and deleted_at is null`,
      [userId],
    );
    return Number(result.rows[0]!.count);
  }

  async readyIdsByOwner(userId: UserIdType): Promise<readonly ModelIdType[]> {
    const result = await this.pool.query<{ id: string }>(`select id from projects where owner_id = $1 and published_revision_id is not null and deleted_at is null`, [userId]);
    return result.rows.map((row) => ModelId(row.id));
  }

  async sumReadyDownloadsByOwner(userId: UserIdType): Promise<number> {
    const result = await this.pool.query<{ downloads: string }>(
      `select coalesce(sum(downloads_count), 0) as downloads
         from projects where owner_id = $1 and published_revision_id is not null and deleted_at is null`,
      [userId],
    );
    return Number(result.rows[0]!.downloads);
  }

  async findBillingModels(modelIds: readonly ModelIdType[]): Promise<ReadonlyMap<ModelIdType, BillingModelSnapshot>> {
    if (modelIds.length === 0) return new Map();
    const result = await this.pool.query<{
      id: string;
      owner_id: string;
      title: string;
      price_minor: string;
      currency: string;
      publish_status: string;
    }>(
      `select p.id, p.owner_id,
              coalesce(pr.metadata_snapshot ->> 'title', p.title) as title,
              p.price_minor, p.currency,
              case when p.published_revision_id is null then 'draft' else 'published' end as publish_status
         from projects p left join project_revisions pr on pr.id = p.published_revision_id and pr.project_id = p.id
        where p.id = any($1::uuid[]) and p.deleted_at is null`,
      [modelIds],
    );
    return new Map(
      result.rows.map((row) => {
        const id = ModelId(row.id);
        return [
          id,
          {
            id,
            ownerId: UserId(row.owner_id),
            title: row.title,
            priceMinor: Number(row.price_minor),
            currency: row.currency,
            publishStatus: row.publish_status,
          },
        ];
      }),
    );
  }

  async searchPublished(query: string, limit: number): Promise<readonly { readonly id: ModelIdType; readonly title: string }[]> {
    const rows = (
      await this.pool.query<{ id: string; title: string }>(
        `select p.id, pr.metadata_snapshot ->> 'title' as title
         from projects p join project_revisions pr on pr.id = p.published_revision_id and pr.project_id = p.id
        where p.deleted_at is null
          and (pr.metadata_snapshot ->> 'title' ilike $1 or pr.metadata_snapshot ->> 'description' ilike $1)
        order by greatest(
          similarity(lower(pr.metadata_snapshot ->> 'title'), lower($2)),
          similarity(lower(coalesce(pr.metadata_snapshot ->> 'description', '')), lower($2))
        ) desc, pr.created_at desc
        limit $3`,
        [`%${query}%`, query, limit],
      )
    ).rows;
    return rows.map((row) => ({ id: ModelId(row.id), title: row.title }));
  }

  async loadDispatchableSlice(sliceJobId: string, actorId: UserIdType): Promise<ModelSliceDispatchResult> {
    const row = (
      await this.pool.query<
        Record<string, unknown> & {
          id: string;
          status: string;
          gcode_s3_key: string | null;
          account_id: string | null;
          device_id: string | null;
          profile_id: string;
          filament_profile_id: string | null;
          model_id: string;
          slice_key: Buffer | null;
          slice_trust_contract_version: string | null;
          slice_trust_material: SliceTrustMaterial | null;
          slice_trust_key_id: string | null;
          slice_trust_signature: string | null;
        }
      >(
        `select id,status,gcode_s3_key,account_id,device_id,profile_id,filament_profile_id,model_id,
              slice_key,slice_trust_contract_version,slice_trust_material,slice_trust_key_id,slice_trust_signature
         from slice_jobs where id=$1 and account_id=$2`,
        [sliceJobId, actorId],
      )
    ).rows[0];
    if (row === undefined) return { kind: "missing" };
    if (row.status !== "ready" || row.gcode_s3_key === null) return { kind: "not_ready" };
    if (!isDispatchableSliceJob(row)) return { kind: "untrusted" };
    return {
      kind: "ready",
      job: {
        ...row,
        gcode_s3_key: row.gcode_s3_key,
        slice_trust_material: row.slice_trust_material as SliceTrustMaterial & { readonly config_fingerprint: string },
      },
    };
  }

  async boundingBoxByInternalModelId(modelId: string): Promise<{ readonly x: number; readonly y: number; readonly z: number } | null> {
    const row = (
      await this.pool.query<{ bbox: unknown }>(
        `select r.bbox from models m join model_revisions r on r.id=m.active_revision_id and r.model_id=m.id
        where m.id=$1 and m.deleted_at is null`,
        [modelId],
      )
    ).rows[0];
    return row === undefined ? null : modelBboxSizeMm(row.bbox);
  }

  async tagIdsForModels(modelIds: readonly ModelIdType[]): Promise<readonly string[]> {
    if (modelIds.length === 0) return [];
    return (await this.pool.query<{ tag_id: string }>(`select distinct tag_id from model_tags where model_id=any($1::uuid[])`, [modelIds])).rows.map((row) => row.tag_id);
  }

  async modelIdsWithAnyTags(modelIds: readonly ModelIdType[], tagIds: readonly string[]): Promise<ReadonlySet<ModelIdType>> {
    if (modelIds.length === 0 || tagIds.length === 0) return new Set();
    const rows = (
      await this.pool.query<{ model_id: string }>(`select distinct model_id from model_tags where model_id=any($1::uuid[]) and tag_id=any($2::uuid[])`, [modelIds, tagIds])
    ).rows;
    return new Set(rows.map((row) => ModelId(row.model_id)));
  }
}
