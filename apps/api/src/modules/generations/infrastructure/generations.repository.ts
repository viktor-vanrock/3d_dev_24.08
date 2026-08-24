import { Inject, Injectable } from "@nestjs/common";
import type { Pool, PoolClient } from "pg";
import { DATABASE_POOL } from "../../../nest/database/database.constants.ts";
import type { UserId } from "../../_kernel/brandedIds.ts";
import type { GenerationOutcome, GenerationResponse } from "../public/index.ts";
import {
  CONCEPT_RENDER_PROFILE,
  generationQuotaDaily,
  generationQuotaHourly,
  staleTimeoutMinutes,
  type ConceptAngle,
  type ConceptRow,
  type GenerationBranch,
  type GenerationRow,
  type HealthRow,
} from "../domain/generations.ts";

export type GenerationExecutor = Pick<PoolClient, "query">;
const ROW_COLUMNS =
  "id, user_id, branch, prompt, params, status, artifact_url, preview_url, error, assistant_offer_id, created_at, updated_at, phase, progress, eta_seconds, estimate_updated_at, preview_shots, source_generation_id, source_angles";
const CONCEPT_SELECT = `select c.id,c.generation_id,c.normalized_query,c.label,c.prompt,c.motif,c.reuse_count,c.status,c.created_at,c.updated_at,g.status as generation_status,g.preview_url from generated_concepts c join generations g on g.id=c.generation_id`;
const QUOTA_LOCK_NAMESPACE = 0x4d46_0673;
const CONCEPT_LOCK_NAMESPACE = 0x4d46_2068;
const ANN_MIN_SCORE = 0.6;
const FUNCTIONAL_MARKER = "Пустая опорная конструкция — главный объект";

export interface GenerationCreateInput {
  readonly userId: UserId;
  readonly branch: GenerationBranch;
  readonly prompt: string;
  readonly params: Record<string, unknown>;
  readonly assistantOfferId: string | null;
  readonly source: { readonly generationId: string; readonly angles: readonly ConceptAngle[] } | null;
  readonly idempotencyKey?: string;
  readonly requestFingerprint?: Buffer;
}
export type GenerationCreateResult =
  | { readonly kind: "created"; readonly row: GenerationRow; readonly queuePosition: number }
  | { readonly kind: "replayed"; readonly status: number; readonly body: GenerationOutcome["body"] }
  | { readonly kind: "idempotency_conflict" }
  | { readonly kind: "hourly_limit"; readonly limit: number }
  | { readonly kind: "daily_limit"; readonly limit: number };

@Injectable()
export class GenerationsRepository {
  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {}

  async transaction<T>(work: (executor: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const result = await work(client);
      await client.query("commit");
      return result;
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async healthRows(): Promise<readonly HealthRow[]> {
    return (await this.pool.query<HealthRow>(`select branch,status,error,created_at from generations where created_at > now()-interval '24 hours' order by created_at desc`)).rows;
  }

  async find(id: string): Promise<GenerationRow | null> {
    return (await this.pool.query<GenerationRow>(`select ${ROW_COLUMNS} from generations where id=$1`, [id])).rows[0] ?? null;
  }

  async findOwned(id: string, userId: UserId): Promise<GenerationRow | null> {
    const row = await this.find(id);
    return row?.user_id === userId ? row : null;
  }

  async listOwned(userId: UserId): Promise<readonly GenerationRow[]> {
    return (await this.pool.query<GenerationRow>(`select ${ROW_COLUMNS} from generations where user_id=$1 order by created_at desc limit 50`, [userId])).rows;
  }

  async resolveStale(row: GenerationRow): Promise<GenerationRow> {
    if (row.status !== "queued" && row.status !== "running") return row;
    const cutoff = new Date(Date.now() - staleTimeoutMinutes() * 60_000);
    if (row.updated_at > cutoff) return row;
    return (
      (
        await this.pool.query<GenerationRow>(
          `with timed_out as(
             update generations
                set status='timed_out',leased_by=null,lease_expires_at=null,updated_at=now()
              where id=$1 and status in ('queued','running') and updated_at<$2
              returning *
           ), concept_failed as(
             update generated_concepts concepts
                set status='failed',updated_at=now()
               from timed_out
              where concepts.generation_id=timed_out.id
           )
           select ${ROW_COLUMNS} from timed_out`,
          [row.id, cutoff],
        )
      ).rows[0] ?? row
    );
  }

  async queuePosition(row: GenerationRow, executor: GenerationExecutor = this.pool): Promise<number | null> {
    if (row.status !== "queued") return null;
    const count = (await executor.query<{ count: string }>(`select count(*) from generations where status='queued' and created_at<$1`, [row.created_at])).rows[0]?.count ?? "0";
    return Number(count) + 1;
  }

  async sourceConcept(id: string): Promise<Pick<GenerationRow, "id" | "user_id" | "branch" | "status" | "preview_shots"> | null> {
    return (
      (
        await this.pool.query<Pick<GenerationRow, "id" | "user_id" | "branch" | "status" | "preview_shots">>(
          `select id,user_id,branch,status,preview_shots from generations where id=$1`,
          [id],
        )
      ).rows[0] ?? null
    );
  }

  async create(input: GenerationCreateInput): Promise<GenerationCreateResult> {
    return this.transaction(async (client) => {
      if (input.idempotencyKey && input.requestFingerprint) {
        await client.query(`insert into generations_idempotency(owner_id,idempotency_key,request_fingerprint) values($1,$2,$3) on conflict(owner_id,idempotency_key) do nothing`, [
          input.userId,
          input.idempotencyKey,
          input.requestFingerprint,
        ]);
        const claim = (
          await client.query<{ request_fingerprint: Buffer; response_status: number | null; response_body: GenerationOutcome["body"] | null }>(
            `select request_fingerprint,response_status,response_body from generations_idempotency where owner_id=$1 and idempotency_key=$2 for update`,
            [input.userId, input.idempotencyKey],
          )
        ).rows[0];
        if (claim === undefined) throw new Error("generation idempotency claim missing");
        if (!claim.request_fingerprint.equals(input.requestFingerprint)) return { kind: "idempotency_conflict" };
        if (claim.response_status !== null && claim.response_body !== null) return { kind: "replayed", status: claim.response_status, body: claim.response_body };
      }
      await client.query("select pg_advisory_xact_lock($1,hashtext($2))", [QUOTA_LOCK_NAMESPACE, input.userId]);
      const quotaBranch = input.branch === "concepts" ? "concepts" : null;
      const usage = (
        await client.query<{ hourly: string; daily: string }>(
          `select count(*) filter(where created_at>now()-interval '1 hour') as hourly,count(*) filter(where created_at>now()-interval '1 day') as daily from generations where user_id=$1 and created_at>now()-interval '1 day' and (($2::text='concepts' and branch='concepts') or ($2::text is null and branch<>'concepts'))`,
          [input.userId, quotaBranch],
        )
      ).rows[0];
      const hourlyLimit = generationQuotaHourly(input.branch);
      const dailyLimit = generationQuotaDaily(input.branch);
      if (Number(usage?.hourly ?? 0) >= hourlyLimit) {
        if (input.idempotencyKey)
          await client.query(`delete from generations_idempotency where owner_id=$1 and idempotency_key=$2 and response_status is null`, [input.userId, input.idempotencyKey]);
        return { kind: "hourly_limit", limit: hourlyLimit };
      }
      if (Number(usage?.daily ?? 0) >= dailyLimit) {
        if (input.idempotencyKey)
          await client.query(`delete from generations_idempotency where owner_id=$1 and idempotency_key=$2 and response_status is null`, [input.userId, input.idempotencyKey]);
        return { kind: "daily_limit", limit: dailyLimit };
      }
      const row = (
        await client.query<GenerationRow>(
          `insert into generations(user_id,branch,prompt,params,assistant_offer_id,source_generation_id,source_angles) values($1,$2,$3,$4,$5,$6,$7) returning ${ROW_COLUMNS}`,
          [input.userId, input.branch, input.prompt, JSON.stringify(input.params), input.assistantOfferId, input.source?.generationId ?? null, input.source?.angles ?? null],
        )
      ).rows[0];
      if (row === undefined) throw new Error("generation insert returned no row");
      const queuePosition = await this.queuePosition(row, client);
      const responseBody = { generation: this.response(row, queuePosition) };
      if (input.idempotencyKey)
        await client.query(`update generations_idempotency set response_status=201,response_body=$3,generation_id=$4,updated_at=now() where owner_id=$1 and idempotency_key=$2`, [
          input.userId,
          input.idempotencyKey,
          responseBody,
          row.id,
        ]);
      return { kind: "created", row, queuePosition: queuePosition ?? 1 };
    });
  }

  private response(row: GenerationRow, queuePosition: number | null): GenerationResponse {
    return {
      id: row.id,
      branch: row.branch,
      prompt: row.prompt,
      params: row.params,
      status: row.status,
      preview_url: row.preview_url ? `/generations/${row.id}/preview` : null,
      artifact_url: row.artifact_url ? `/generations/${row.id}/artifact` : null,
      preview_shots: row.preview_shots?.map((shot) => ({ angle: shot.angle, url: `/generations/${row.id}/preview/${shot.angle}` })) ?? null,
      source_generation_id: row.source_generation_id,
      source_angles: row.source_angles,
      error: row.error,
      error_code: null,
      retryable: null,
      progress: null,
      delayed: null,
      queue_position: queuePosition,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  }

  async findStartedScan(userId: UserId, scanId: string): Promise<GenerationRow | null> {
    return (
      (
        await this.pool.query<GenerationRow>(`select ${ROW_COLUMNS} from generations where user_id=$1 and branch='scan' and params->>'scan_id'=$2 order by created_at limit 1`, [
          userId,
          scanId,
        ])
      ).rows[0] ?? null
    );
  }

  async assetOwner(id: string): Promise<{
    readonly id: string;
    readonly user_id: string;
    readonly branch: string;
    readonly preview_url: string | null;
    readonly artifact_url: string | null;
    readonly preview_shots: readonly { readonly angle: string; readonly s3_key: string }[] | null;
  } | null> {
    return (
      (
        await this.pool.query<{
          id: string;
          user_id: string;
          branch: string;
          preview_url: string | null;
          artifact_url: string | null;
          preview_shots: readonly { angle: string; s3_key: string }[] | null;
        }>(`select id,user_id,branch,preview_url,artifact_url,preview_shots from generations where id=$1`, [id])
      ).rows[0] ?? null
    );
  }

  async conceptPreviewKey(id: string): Promise<string | null> {
    return (
      (
        await this.pool.query<{ preview_url: string }>(
          `select g.preview_url from generated_concepts c join generations g on g.id=c.generation_id where c.id=$1 and c.status='ready' and g.status='done' and g.preview_url is not null`,
          [id],
        )
      ).rows[0]?.preview_url ?? null
    );
  }

  async globalConcepts(offset: number, limit: number): Promise<readonly ConceptRow[]> {
    return (
      await this.pool.query<ConceptRow>(
        `select id,generation_id,normalized_query,label,prompt,motif,reuse_count,status,created_at,updated_at,generation_status,preview_url from(select c.id,c.generation_id,c.normalized_query,c.label,c.prompt,c.motif,c.reuse_count,c.status,c.created_at,c.updated_at,g.status as generation_status,g.preview_url,coalesce(c.ready_at,c.updated_at) as sort_at,row_number() over(partition by c.normalized_query order by coalesce(c.ready_at,c.updated_at) desc,c.id desc) as query_rank from generated_concepts c join generations g on g.id=c.generation_id where c.status='ready' and g.status='done' and g.preview_url is not null) ranked order by query_rank,sort_at desc,id desc limit $1 offset $2`,
        [limit, offset],
      )
    ).rows;
  }

  async exactQueryConcepts(query: string, limit: number, functionalOnly: boolean): Promise<readonly ConceptRow[]> {
    return (
      await this.pool.query<ConceptRow>(
        `select c.id,c.generation_id,c.normalized_query,c.label,c.prompt,c.motif,c.reuse_count,c.status,c.created_at,c.updated_at,g.status as generation_status,g.preview_url,1::double precision as score from generated_concepts c join generations g on g.id=c.generation_id where c.status='ready' and g.status='done' and g.preview_url is not null and c.normalized_query=$1 and(not $3::boolean or(position($4 in c.prompt)>0 and c.cache_key like $5)) order by coalesce(c.ready_at,c.updated_at) desc,c.reuse_count desc,c.id desc limit $2`,
        [query, limit, functionalOnly, FUNCTIONAL_MARKER, `${CONCEPT_RENDER_PROFILE}:%`],
      )
    ).rows;
  }

  async semanticConcepts(vectorLiteral: string, limit: number, functionalOnly: boolean): Promise<readonly ConceptRow[]> {
    return (
      await this.pool.query<ConceptRow>(
        `select c.id,c.generation_id,c.normalized_query,c.label,c.prompt,c.motif,c.reuse_count,c.status,c.created_at,c.updated_at,g.status as generation_status,g.preview_url,1-(c.embedding_2048<=>$1::halfvec(2048)) as score from generated_concepts c join generations g on g.id=c.generation_id where c.status='ready' and g.status='done' and g.preview_url is not null and c.embedding_2048 is not null and 1-(c.embedding_2048<=>$1::halfvec(2048)) >=$2 and(not $4::boolean or(position($5 in c.prompt)>0 and c.cache_key like $6)) order by c.embedding_2048<=>$1::halfvec(2048),c.reuse_count desc limit $3`,
        [vectorLiteral, ANN_MIN_SCORE, limit, functionalOnly, FUNCTIONAL_MARKER, `${CONCEPT_RENDER_PROFILE}:%`],
      )
    ).rows;
  }

  async lexicalConcepts(query: string, limit: number, excludedIds: readonly string[], functionalOnly: boolean): Promise<readonly ConceptRow[]> {
    const haystack = "lower(c.normalized_query||' '||c.label||' '||c.prompt)";
    return (
      await this.pool.query<ConceptRow>(
        `select c.id,c.generation_id,c.normalized_query,c.label,c.prompt,c.motif,c.reuse_count,c.status,c.created_at,c.updated_at,g.status as generation_status,g.preview_url,greatest(similarity(${haystack},$2),0)::double precision as score from generated_concepts c join generations g on g.id=c.generation_id where c.status='ready' and g.status='done' and g.preview_url is not null and(${haystack} like $1 or similarity(${haystack},$2)>0.18) and(cardinality($4::uuid[])=0 or not(c.id=any($4::uuid[]))) and(not $5::boolean or(position($6 in c.prompt)>0 and c.cache_key like $7)) order by(${haystack} like $1) desc,score desc,c.reuse_count desc,c.created_at desc limit $3`,
        [`%${query}%`, query, limit, excludedIds, functionalOnly, FUNCTIONAL_MARKER, `${CONCEPT_RENDER_PROFILE}:%`],
      )
    ).rows;
  }

  async withConceptLock<T>(cacheKey: string, work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("select pg_advisory_lock($1,hashtext($2))", [CONCEPT_LOCK_NAMESPACE, cacheKey]);
      return await work(client);
    } finally {
      await client.query("select pg_advisory_unlock($1,hashtext($2))", [CONCEPT_LOCK_NAMESPACE, cacheKey]).catch(() => undefined);
      client.release();
    }
  }

  async exactConcept(client: GenerationExecutor, cacheKey: string): Promise<ConceptRow | null> {
    return (await client.query<ConceptRow>(`${CONCEPT_SELECT} where c.cache_key=$1 limit 1`, [cacheKey])).rows[0] ?? null;
  }

  async reuseConcept(client: GenerationExecutor, row: ConceptRow): Promise<ConceptRow> {
    const current = (await client.query<ConceptRow>(`${CONCEPT_SELECT} where c.id=$1 limit 1`, [row.id])).rows[0] ?? row;
    await client.query(`update generated_concepts set reuse_count=reuse_count+1,updated_at=now() where id=$1`, [row.id]);
    current.reuse_count = Number(current.reuse_count) + 1;
    return current;
  }

  async insertConcept(
    client: GenerationExecutor,
    input: {
      readonly generationId: string;
      readonly normalizedQuery: string;
      readonly label: string;
      readonly prompt: string;
      readonly motif: string | null;
      readonly cacheKey: string;
      readonly embeddingLiteral: string | null;
    },
  ): Promise<ConceptRow> {
    const row = (
      await client.query<ConceptRow>(
        `insert into generated_concepts(generation_id,normalized_query,label,prompt,motif,cache_key,embedding_2048) values($1,$2,$3,$4,$5,$6,$7::halfvec(2048)) on conflict(cache_key) do update set generation_id=excluded.generation_id,normalized_query=excluded.normalized_query,label=excluded.label,prompt=excluded.prompt,motif=excluded.motif,embedding_2048=coalesce(excluded.embedding_2048,generated_concepts.embedding_2048),status='queued',updated_at=now(),ready_at=null returning id,generation_id,normalized_query,label,prompt,motif,reuse_count,status,created_at,updated_at,'queued'::text as generation_status,null::text as preview_url`,
        [input.generationId, input.normalizedQuery, input.label, input.prompt, input.motif, input.cacheKey, input.embeddingLiteral],
      )
    ).rows[0];
    if (row === undefined) throw new Error("generated concept insert returned no row");
    return row;
  }

  async ownedDoneForUpdate(
    executor: GenerationExecutor,
    id: string,
    userId: UserId,
  ): Promise<{
    readonly id: string;
    readonly user_id: string;
    readonly branch: GenerationBranch;
    readonly prompt: string;
    readonly artifact_url: string | null;
    readonly preview_url: string | null;
  } | null> {
    const row = (
      await executor.query<{ id: string; user_id: string; branch: GenerationBranch; prompt: string; artifact_url: string | null; preview_url: string | null }>(
        `select id,user_id,branch,prompt,artifact_url,preview_url from generations where id=$1 and status='done' for update`,
        [id],
      )
    ).rows[0];
    return row?.user_id === userId ? row : null;
  }
}
