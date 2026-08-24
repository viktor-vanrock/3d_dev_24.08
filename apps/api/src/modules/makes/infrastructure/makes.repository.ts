import { Inject, Injectable } from "@nestjs/common";
import type { Pool } from "pg";
import { DATABASE_POOL } from "../../../nest/database/database.constants.ts";
import { MakeId, ModelId, UserId, type UserId as UserIdType } from "../../_kernel/brandedIds.ts";
import type { MakeRecord, MakeStatus } from "../domain/makes.ts";
import type { MakesReadPort } from "../public/index.ts";

const MAKE_FIELDS = `mk.id, mk.model_id, mk.user_id, mk.machine_id, mk.caption,
  mk.printability_rating, mk.geometry_quality_rating, mk.surface_quality_rating,
  mk.issue_tags, mk.notes, mk.print_settings, mk.status, mk.likes_count,
  mk.comments_count, mk.reposts_count, mk.views_count, mk.created_at, mk.photo_s3_key,
  coalesce((select mp.s3_key from make_photos mp
    where mp.make_id = mk.id and mp.is_cover and mp.moderation_status = 'approved'
    limit 1), mk.photo_s3_key) as cover_photo_s3_key`;

interface MakeRow extends Omit<MakeRecord, "id" | "model_id" | "user_id"> {
  readonly id: string;
  readonly model_id: string | null;
  readonly user_id: string;
}

function make(row: MakeRow): MakeRecord {
  return {
    ...row,
    id: MakeId(row.id),
    model_id: row.model_id === null ? null : ModelId(row.model_id),
    user_id: UserId(row.user_id),
    likes_count: Number(row.likes_count),
    comments_count: Number(row.comments_count),
    reposts_count: Number(row.reposts_count),
    views_count: Number(row.views_count),
  };
}

@Injectable()
export class MakesRepository implements MakesReadPort {
  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {}

  async isOwned(makeId: string, userId: UserIdType): Promise<boolean> {
    return ((await this.pool.query(`select 1 from makes where id = $1 and user_id = $2`, [makeId, userId])).rowCount ?? 0) > 0;
  }

  async create(input: {
    readonly modelId: ModelId | null;
    readonly userId: UserIdType;
    readonly machineId: string;
    readonly materialIds: readonly string[];
    readonly caption: string | null;
    readonly printabilityRating: number | null;
    readonly geometryQualityRating: number | null;
    readonly surfaceQualityRating: number | null;
    readonly issueTags: readonly string[];
    readonly notes: string | null;
    readonly printSettings: Readonly<Record<string, unknown>>;
  }): Promise<MakeRecord> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const inserted = await client.query<MakeRow>(
        `insert into makes (model_id, user_id, machine_id, caption, printability_rating,
           geometry_quality_rating, surface_quality_rating, issue_tags, notes, print_settings, status)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'published')
         returning id, model_id, user_id, machine_id, caption, printability_rating,
           geometry_quality_rating, surface_quality_rating, issue_tags, notes, print_settings,
           status, likes_count, comments_count, reposts_count, views_count, created_at,
           photo_s3_key, photo_s3_key as cover_photo_s3_key`,
        [
          input.modelId,
          input.userId,
          input.machineId,
          input.caption,
          input.printabilityRating,
          input.geometryQualityRating,
          input.surfaceQualityRating,
          input.issueTags,
          input.notes,
          JSON.stringify(input.printSettings),
        ],
      );
      for (const materialId of new Set(input.materialIds)) {
        await client.query(`insert into make_materials (make_id, material_id) values ($1, $2)`, [inserted.rows[0]!.id, materialId]);
      }
      await client.query("commit");
      return make(inserted.rows[0]!);
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async delete(makeId: MakeId): Promise<void> {
    await this.pool.query(`delete from makes where id = $1`, [makeId]);
  }

  async find(makeId: MakeId): Promise<MakeRecord | null> {
    const row = (await this.pool.query<MakeRow>(`select ${MAKE_FIELDS} from makes mk where mk.id = $1`, [makeId])).rows[0];
    return row === undefined ? null : make(row);
  }

  async publishedExists(makeId: MakeId): Promise<boolean> {
    return ((await this.pool.query(`select 1 from makes where id = $1 and status = 'published'`, [makeId])).rowCount ?? 0) > 0;
  }

  async list(input: {
    readonly machineId: string | null;
    readonly materialId: string | null;
    readonly modelId: ModelId | null;
    readonly taggedModelIds: readonly ModelId[] | null;
    readonly sort: "new" | "popular";
    readonly cursor: readonly (string | number)[] | null;
    readonly limit: number;
  }): Promise<readonly MakeRecord[]> {
    const params: unknown[] = [];
    const conditions = ["mk.status = 'published'"];
    if (input.machineId !== null) {
      params.push(input.machineId);
      conditions.push(`mk.machine_id = $${params.length}`);
    }
    if (input.materialId !== null) {
      params.push(input.materialId);
      conditions.push(`exists (select 1 from make_materials mm where mm.make_id = mk.id and mm.material_id = $${params.length})`);
    }
    if (input.modelId !== null) {
      params.push(input.modelId);
      conditions.push(`mk.model_id = $${params.length}`);
    }
    if (input.taggedModelIds !== null) {
      params.push(input.taggedModelIds);
      conditions.push(`mk.model_id = any($${params.length}::uuid[])`);
    }
    const cursor = input.cursor;
    if (input.sort === "popular" && cursor !== null && typeof cursor[0] === "number" && typeof cursor[1] === "string" && typeof cursor[2] === "string") {
      params.push(cursor[0], cursor[1], cursor[2]);
      conditions.push(`(mk.likes_count, mk.created_at, mk.id) < ($${params.length - 2}::int, $${params.length - 1}::timestamptz, $${params.length}::uuid)`);
    }
    if (input.sort === "new" && cursor !== null && typeof cursor[0] === "string" && typeof cursor[1] === "string") {
      params.push(cursor[0], cursor[1]);
      conditions.push(`(mk.created_at, mk.id) < ($${params.length - 1}::timestamptz, $${params.length}::uuid)`);
    }
    params.push(input.limit + 1);
    const order = input.sort === "popular" ? "mk.likes_count desc, mk.created_at desc, mk.id desc" : "mk.created_at desc, mk.id desc";
    const result = await this.pool.query<MakeRow>(`select ${MAKE_FIELDS} from makes mk where ${conditions.join(" and ")} order by ${order} limit $${params.length}`, params);
    return result.rows.map(make);
  }

  async followedFeed(authorIds: readonly UserIdType[], cursor: readonly string[] | null, limit: number): Promise<readonly MakeRecord[]> {
    if (authorIds.length === 0) return [];
    const params: unknown[] = [authorIds];
    const conditions = ["mk.status = 'published'", "mk.user_id = any($1::uuid[])"];
    if (cursor !== null) {
      params.push(cursor[0], cursor[1]);
      conditions.push(`(mk.created_at, mk.id) < ($2::timestamptz, $3::uuid)`);
    }
    params.push(limit + 1);
    const result = await this.pool.query<MakeRow>(
      `select ${MAKE_FIELDS} from makes mk where ${conditions.join(" and ")}
       order by mk.created_at desc, mk.id desc limit $${params.length}`,
      params,
    );
    return result.rows.map(make);
  }

  async mine(userId: UserIdType, cursor: readonly string[] | null, limit: number): Promise<readonly MakeRecord[]> {
    const params: unknown[] = [userId];
    const conditions = ["mk.user_id = $1"];
    if (cursor !== null) {
      params.push(cursor[0], cursor[1]);
      conditions.push(`(mk.created_at, mk.id) < ($2::timestamptz, $3::uuid)`);
    }
    params.push(limit + 1);
    const result = await this.pool.query<MakeRow>(
      `select ${MAKE_FIELDS} from makes mk where ${conditions.join(" and ")} order by mk.created_at desc, mk.id desc limit $${params.length}`,
      params,
    );
    return result.rows.map(make);
  }

  async materialIds(makeId: MakeId): Promise<readonly string[]> {
    return (await this.pool.query<{ material_id: string }>(`select material_id from make_materials where make_id = $1 order by material_id`, [makeId])).rows.map(
      (row) => row.material_id,
    );
  }

  async photos(makeId: MakeId, includeUnapproved: boolean) {
    const result = await this.pool.query<{ id: string; position: number; is_cover: boolean; moderation_status: string }>(
      `select id, position, is_cover, moderation_status from make_photos where make_id = $1
       ${includeUnapproved ? "" : "and moderation_status = 'approved'"} order by position`,
      [makeId],
    );
    return result.rows;
  }

  async relatedByModel(modelId: ModelId, excludedId: MakeId, limit: number): Promise<readonly MakeRecord[]> {
    return (
      await this.pool.query<MakeRow>(
        `select ${MAKE_FIELDS} from makes mk where mk.status = 'published' and mk.model_id = $1 and mk.id <> $2
       order by mk.created_at desc, mk.id desc limit $3`,
        [modelId, excludedId, limit],
      )
    ).rows.map(make);
  }

  async relatedByMaterial(materialId: string, excludedId: MakeId, limit: number): Promise<readonly MakeRecord[]> {
    return (
      await this.pool.query<MakeRow>(
        `select ${MAKE_FIELDS} from makes mk where mk.status = 'published' and mk.id <> $2 and
       exists (select 1 from make_materials mm where mm.make_id = mk.id and mm.material_id = $1)
       order by mk.created_at desc, mk.id desc limit $3`,
        [materialId, excludedId, limit],
      )
    ).rows.map(make);
  }

  async leaderboard(modelId: ModelId, limit: number): Promise<readonly MakeRecord[]> {
    return (
      await this.pool.query<MakeRow>(
        `select ${MAKE_FIELDS} from makes mk where mk.model_id = $1 and mk.status = 'published'
       order by mk.likes_count desc, mk.created_at asc limit $2`,
        [modelId, limit],
      )
    ).rows.map(make);
  }

  async increment(makeId: MakeId, field: "reposts_count" | "views_count"): Promise<number | null> {
    const result = await this.pool.query<Record<"value", number>>(`update makes set ${field} = ${field} + 1 where id = $1 and status = 'published' returning ${field} as value`, [
      makeId,
    ]);
    return result.rows[0] === undefined ? null : Number(result.rows[0].value);
  }

  async setLikesCount(makeId: MakeId, count: number): Promise<void> {
    await this.pool.query(`update makes set likes_count = $2 where id = $1`, [makeId, count]);
  }

  async incrementComments(makeId: MakeId): Promise<void> {
    await this.pool.query(`update makes set comments_count = comments_count + 1 where id = $1`, [makeId]);
  }

  async hide(makeId: MakeId): Promise<MakeStatus> {
    const result = await this.pool.query<{ status: MakeStatus }>(`update makes set status = 'hidden' where id = $1 returning status`, [makeId]);
    return result.rows[0]!.status;
  }

  async photo(makeId: MakeId, photoId: string): Promise<{ readonly make: MakeRecord; readonly s3Key: string; readonly moderationStatus: string } | null> {
    const record = await this.find(makeId);
    if (record === null) return null;
    const row = (
      await this.pool.query<{ s3_key: string; moderation_status: string }>(`select s3_key, moderation_status from make_photos where id = $1 and make_id = $2`, [photoId, makeId])
    ).rows[0];
    return row === undefined ? null : { make: record, s3Key: row.s3_key, moderationStatus: row.moderation_status };
  }
}
