import { Inject, Injectable } from "@nestjs/common";
import type { Pool, PoolClient } from "pg";
import { DATABASE_POOL } from "../../../nest/database/database.constants.ts";
import { IdeaId, UserId, type IdeaId as IdeaIdType, type UserId as UserIdType } from "../../_kernel/brandedIds.ts";
import type { Idea, IdeaComment, IdeaOrigin, IdeaStatus } from "../domain/ideas.ts";

interface IdeaRow {
  id: string;
  author_id: string;
  title: string;
  body: string;
  category: Idea["category"];
  type: Idea["type"];
  status: IdeaStatus;
  canonical_id: string | null;
  vote_count: number;
  decline_reason: string | null;
  origin: IdeaOrigin | null;
  ai_assisted: boolean;
  created_at: Date;
  last_activity_at: Date;
}

interface CommentRow {
  id: string;
  idea_id: string;
  user_id: string;
  body: string;
  created_at: Date;
}

export interface IdeaListSpec {
  readonly type: string;
  readonly category?: string;
  readonly status?: string;
  readonly tab: "new" | "popular" | "trending";
  readonly cursor: readonly (string | number)[] | null;
  readonly limit: number;
}

const IDEA_FIELDS = `id, author_id, title, body, category, type, status, canonical_id, vote_count,
  decline_reason, origin, ai_assisted, created_at, last_activity_at`;
const CREATE_QUOTA_LOCK = 0x4d46_0690;
const ENRICH_QUOTA_LOCK = 0x4d46_0565;

function idea(row: IdeaRow): Idea {
  return {
    ...row,
    id: IdeaId(row.id),
    author_id: UserId(row.author_id),
    canonical_id: row.canonical_id === null ? null : IdeaId(row.canonical_id),
  };
}

function comment(row: CommentRow): IdeaComment {
  return { ...row, idea_id: IdeaId(row.idea_id), user_id: UserId(row.user_id) };
}

@Injectable()
export class IdeasRepository {
  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {}

  async list(spec: IdeaListSpec): Promise<Idea[]> {
    const conditions = ["type = $1"];
    const params: unknown[] = [spec.type];
    if (spec.category !== undefined) {
      params.push(spec.category);
      conditions.push(`category = $${params.length}`);
    }
    if (spec.status !== undefined) {
      params.push(spec.status);
      conditions.push(`status = $${params.length}`);
    } else {
      conditions.push(`status not in ('archived', 'duplicate', 'hidden', 'removed')`);
    }

    if (spec.tab === "trending") {
      const result = await this.pool.query<IdeaRow>(
        `select ${IDEA_FIELDS} from ideas where ${conditions.join(" and ")}
         and created_at > now() - interval '30 days' order by created_at desc limit 200`,
        params,
      );
      return result.rows.map(idea);
    }

    let orderBy = "created_at desc, id desc";
    if (spec.tab === "popular") {
      orderBy = "vote_count desc, created_at desc, id desc";
      if (spec.cursor !== null && typeof spec.cursor[0] === "number" && typeof spec.cursor[1] === "string" && typeof spec.cursor[2] === "string") {
        params.push(spec.cursor[0], spec.cursor[1], spec.cursor[2]);
        conditions.push(`(vote_count, created_at, id) < ($${params.length - 2}::int, $${params.length - 1}::timestamptz, $${params.length}::uuid)`);
      }
    } else if (spec.cursor !== null && typeof spec.cursor[0] === "string" && typeof spec.cursor[1] === "string") {
      params.push(spec.cursor[0], spec.cursor[1]);
      conditions.push(`(created_at, id) < ($${params.length - 1}::timestamptz, $${params.length}::uuid)`);
    }

    const result = await this.pool.query<IdeaRow>(`select ${IDEA_FIELDS} from ideas where ${conditions.join(" and ")} order by ${orderBy} limit ${spec.limit + 1}`, params);
    return result.rows.map(idea);
  }

  async mine(userId: UserIdType, cursor: readonly (string | number)[] | null, limit: number): Promise<Idea[]> {
    const params: unknown[] = [userId];
    const conditions = ["author_id = $1"];
    if (cursor !== null && typeof cursor[0] === "string" && typeof cursor[1] === "string") {
      params.push(cursor[0], cursor[1]);
      conditions.push(`(created_at, id) < ($${params.length - 1}::timestamptz, $${params.length}::uuid)`);
    }
    const result = await this.pool.query<IdeaRow>(
      `select ${IDEA_FIELDS} from ideas where ${conditions.join(" and ")}
       order by created_at desc, id desc limit ${limit + 1}`,
      params,
    );
    return result.rows.map(idea);
  }

  async find(id: IdeaIdType): Promise<Idea | null> {
    const result = await this.pool.query<IdeaRow>(`select ${IDEA_FIELDS} from ideas where id = $1`, [id]);
    return result.rows[0] === undefined ? null : idea(result.rows[0]);
  }

  async detailParts(
    id: IdeaIdType,
    viewerId: UserIdType | null,
  ): Promise<{
    readonly idea: Idea | null;
    readonly comments: IdeaComment[];
    readonly viewerHasVoted: boolean;
  }> {
    const [ideaResult, commentsResult, voteResult] = await Promise.all([
      this.pool.query<IdeaRow>(`select ${IDEA_FIELDS} from ideas where id = $1`, [id]),
      this.pool.query<CommentRow>(
        `select id, idea_id, user_id, body, created_at from idea_comments
         where idea_id = $1 and deleted_at is null order by created_at asc limit 20`,
        [id],
      ),
      viewerId === null ? Promise.resolve(null) : this.pool.query(`select 1 from idea_votes where idea_id = $1 and user_id = $2`, [id, viewerId]),
    ]);
    return {
      idea: ideaResult.rows[0] === undefined ? null : idea(ideaResult.rows[0]),
      comments: commentsResult.rows.map(comment),
      viewerHasVoted: (voteResult?.rowCount ?? 0) > 0,
    };
  }

  async top(
    category: string | undefined,
    status: string | undefined,
    limit: number,
  ): Promise<
    Array<{
      readonly id: IdeaIdType;
      readonly title: string;
      readonly category: string;
      readonly status: string;
      readonly vote_count: number;
      readonly created_at: Date;
    }>
  > {
    const conditions = ["type = 'idea'"];
    const params: unknown[] = [];
    if (category !== undefined) {
      params.push(category);
      conditions.push(`category = $${params.length}`);
    }
    if (status !== undefined) {
      params.push(status);
      conditions.push(`status = $${params.length}`);
    } else {
      conditions.push(`status not in ('archived', 'duplicate', 'hidden', 'removed')`);
    }
    params.push(limit);
    const result = await this.pool.query<{ id: string; title: string; category: string; status: string; vote_count: number; created_at: Date }>(
      `select id, title, category, status, vote_count, created_at from ideas
       where ${conditions.join(" and ")} order by vote_count desc, created_at desc, id desc limit $${params.length}`,
      params,
    );
    return result.rows.map((row) => ({ ...row, id: IdeaId(row.id) }));
  }

  async similar(query: string): Promise<Array<{ readonly id: IdeaIdType; readonly title: string; readonly vote_count: number; readonly status: string }>> {
    const result = await this.pool.query<{ id: string; title: string; vote_count: number; status: string }>(
      `select id, title, vote_count, status from ideas
       where type = 'idea' and status not in ('archived', 'duplicate') and similarity(title, $1) > $2
       order by similarity(title, $1) desc limit $3`,
      [query, 0.2, 5],
    );
    return result.rows.map((row) => ({ ...row, id: IdeaId(row.id) }));
  }

  async createWithinQuota(
    userId: UserIdType,
    input: {
      readonly title: string;
      readonly body: string;
      readonly category: string;
      readonly type: string;
      readonly origin: IdeaOrigin | null;
      readonly aiAssisted: boolean;
    },
  ): Promise<{ readonly kind: "created"; readonly idea: Idea; readonly remaining: number } | { readonly kind: "limited" }> {
    return this.transaction<{ readonly kind: "created"; readonly idea: Idea; readonly remaining: number } | { readonly kind: "limited" }>(async (client) => {
      await client.query("select pg_advisory_xact_lock($1, hashtext($2))", [CREATE_QUOTA_LOCK, userId]);
      const usage = await client.query<{ count: string }>(`select count(*) from ideas where author_id = $1 and created_at > now() - interval '1 day'`, [userId]);
      const used = Number(usage.rows[0]?.count ?? 0);
      if (used >= 3) return { commit: false, value: { kind: "limited" } as const };
      const inserted = await client.query<IdeaRow>(
        `insert into ideas (author_id, title, body, category, type, origin, ai_assisted)
         values ($1, $2, $3, $4, $5, $6, $7) returning ${IDEA_FIELDS}`,
        [userId, input.title, input.body, input.category, input.type, input.origin === null ? null : JSON.stringify(input.origin), input.aiAssisted],
      );
      return { commit: true, value: { kind: "created", idea: idea(inserted.rows[0]!), remaining: 3 - used - 1 } as const };
    });
  }

  async consumeEnrichmentQuota(userId: UserIdType): Promise<boolean> {
    return this.transaction(async (client) => {
      await client.query("select pg_advisory_xact_lock($1, hashtext($2))", [ENRICH_QUOTA_LOCK, userId]);
      const usage = await client.query<{ count: string }>(`select count(*) from idea_enrichments where user_id = $1 and created_at > now() - interval '1 day'`, [userId]);
      if (Number(usage.rows[0]?.count ?? 0) >= 10) return { commit: false, value: false };
      await client.query(`insert into idea_enrichments (user_id) values ($1)`, [userId]);
      return { commit: true, value: true };
    });
  }

  async toggleVote(userId: UserIdType, id: IdeaIdType): Promise<{ readonly exists: boolean; readonly hasVoted: boolean; readonly voteCount: number }> {
    return this.transaction<{ readonly exists: boolean; readonly hasVoted: boolean; readonly voteCount: number }>(async (client) => {
      const exists = await client.query(`select 1 from ideas where id = $1 for update`, [id]);
      if (exists.rowCount === 0) {
        return { commit: false, value: { exists: false, hasVoted: false, voteCount: 0 } };
      }
      const inserted = await client.query(`insert into idea_votes (idea_id, user_id) values ($1, $2) on conflict do nothing returning idea_id`, [id, userId]);
      const hasVoted = (inserted.rowCount ?? 0) > 0;
      if (!hasVoted) await client.query(`delete from idea_votes where idea_id = $1 and user_id = $2`, [id, userId]);
      await client.query(`insert into idea_vote_log (event, user_id, idea_id) values ($1, $2, $3)`, [hasVoted ? "cast" : "revoke", userId, id]);
      const count = await client.query<{ vote_count: string }>(`select count(*)::int as vote_count from idea_votes where idea_id = $1`, [id]);
      const voteCount = Number(count.rows[0]?.vote_count ?? 0);
      await client.query(`update ideas set vote_count = $2, last_activity_at = now() where id = $1`, [id, voteCount]);
      return { commit: true, value: { exists: true, hasVoted, voteCount } };
    });
  }

  async clusterVoteCounts(ids: readonly IdeaIdType[]): Promise<ReadonlyMap<IdeaIdType, number>> {
    if (ids.length === 0) return new Map();
    const clustered = await this.pool.query<{ canonical_id: string }>(`select distinct canonical_id from ideas where canonical_id = any($1::uuid[])`, [ids]);
    const roots = clustered.rows.map((row) => row.canonical_id);
    if (roots.length === 0) return new Map();
    const counted = await this.pool.query<{ root_id: string; vote_count: number }>(
      `select root_id, count(distinct user_id)::int as vote_count from (
         select id as root_id, id as member_id from ideas where id = any($1::uuid[])
         union all select canonical_id as root_id, id as member_id from ideas where canonical_id = any($1::uuid[])
       ) members join idea_votes v on v.idea_id = members.member_id group by root_id`,
      [roots],
    );
    return new Map(counted.rows.map((row) => [IdeaId(row.root_id), row.vote_count]));
  }

  async comments(id: IdeaIdType, cursor: string | null, limit: number): Promise<IdeaComment[]> {
    const params: unknown[] = [id];
    let condition = "idea_id = $1 and deleted_at is null";
    if (cursor !== null) {
      params.push(cursor);
      condition += ` and created_at > $${params.length}::timestamptz`;
    }
    const result = await this.pool.query<CommentRow>(
      `select id, idea_id, user_id, body, created_at from idea_comments
       where ${condition} order by created_at asc limit ${limit + 1}`,
      params,
    );
    return result.rows.map(comment);
  }

  async addComment(userId: UserIdType, id: IdeaIdType, body: string): Promise<{ readonly comment: IdeaComment; readonly authorId: UserIdType; readonly title: string } | null> {
    const found = await this.pool.query<{ author_id: string; title: string }>(`select author_id, title from ideas where id = $1`, [id]);
    const target = found.rows[0];
    if (target === undefined) return null;
    const inserted = await this.pool.query<CommentRow>(
      `insert into idea_comments (idea_id, user_id, body) values ($1, $2, $3)
       returning id, idea_id, user_id, body, created_at`,
      [id, userId, body],
    );
    await this.pool.query(`update ideas set last_activity_at = now() where id = $1`, [id]);
    return { comment: comment(inserted.rows[0]!), authorId: UserId(target.author_id), title: target.title };
  }

  async canonicalExists(id: string): Promise<boolean> {
    return (await this.pool.query(`select 1 from ideas where id = $1`, [id])).rowCount !== 0;
  }

  async changeStatus(id: IdeaIdType, status: IdeaStatus, reason: string | null, canonicalId: IdeaIdType | null): Promise<{ readonly authorId: UserIdType } | null> {
    const found = await this.pool.query<{ author_id: string }>(`select author_id from ideas where id = $1`, [id]);
    const row = found.rows[0];
    if (row === undefined) return null;
    await this.pool.query(`update ideas set status = $2, decline_reason = $3, canonical_id = $4, last_activity_at = now() where id = $1`, [id, status, reason, canonicalId]);
    return { authorId: UserId(row.author_id) };
  }

  async notifyStatus(id: IdeaIdType, userId: UserIdType, status: IdeaStatus, reason: string | null, title: string): Promise<void> {
    await this.pool.query(
      `insert into idea_notifications (idea_id, user_id, status, title, message, deep_link)
       values ($1, $2, $3, $4, $5, $6)`,
      [id, userId, status, title, reason, `/issue/${id}`],
    );
  }

  async moderate(id: IdeaIdType, action: "hide" | "unhide" | "remove", reason: string | null): Promise<IdeaStatus | "not_hidden" | null> {
    const found = await this.pool.query<{ status: IdeaStatus }>(`select status from ideas where id = $1`, [id]);
    const row = found.rows[0];
    if (row === undefined) return null;
    if (action === "unhide" && row.status !== "hidden") return "not_hidden";
    if (action === "hide") {
      await this.pool.query(`update ideas set status = 'hidden', decline_reason = $2, last_activity_at = now() where id = $1`, [id, reason]);
      return "hidden";
    }
    if (action === "unhide") {
      await this.pool.query(`update ideas set status = 'proposed', decline_reason = null, last_activity_at = now() where id = $1`, [id]);
      return "proposed";
    }
    await this.pool.query(`update ideas set status = 'removed', title = '[удалено]', body = '[удалено]', decline_reason = $2, last_activity_at = now() where id = $1`, [
      id,
      reason,
    ]);
    return "removed";
  }

  private async transaction<T>(work: (client: PoolClient) => Promise<{ readonly commit: boolean; readonly value: T }>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const result = await work(client);
      await client.query(result.commit ? "commit" : "rollback");
      return result.value;
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }
}
