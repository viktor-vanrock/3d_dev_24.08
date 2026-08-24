import { Inject, Injectable } from "@nestjs/common";
import type { Pool, PoolClient } from "pg";
import { DATABASE_POOL } from "../../../nest/database/database.constants.ts";
import { CommentId, FeedPostId, ModelId, UserId, type UserId as UserIdType } from "../../_kernel/brandedIds.ts";
import type { FeedCommentRecord, FeedPostRecord, FeedPostType } from "../domain/feed.ts";
import type { FeedModerationComment, FeedRankingReadPort } from "../public/index.ts";

const POST_FIELDS = `id, author_id, co_author_agent_id, community_id, type, title, body, model_id,
  media_s3_key, make_id, poster_s3_key, gitverse_url, gitverse_meta, votes_up, votes_down,
  comments_count, status, created_at, is_edited, edited_at, source_url, source_fingerprint,
  ingest_provider, ingest_model, ingest_prompt_version`;

interface PostRow extends Omit<FeedPostRecord, "id" | "author_id" | "model_id"> {
  readonly id: string;
  readonly author_id: string;
  readonly model_id: string | null;
}

interface CommentRow extends Omit<FeedCommentRecord, "id" | "user_id" | "parent_id"> {
  readonly id: string;
  readonly user_id: string;
  readonly parent_id: string | null;
}

function post(row: PostRow): FeedPostRecord {
  return {
    ...row,
    id: FeedPostId(row.id),
    author_id: UserId(row.author_id),
    model_id: row.model_id === null ? null : ModelId(row.model_id),
  };
}

function comment(row: CommentRow): FeedCommentRecord {
  return {
    ...row,
    id: CommentId(row.id),
    user_id: UserId(row.user_id),
    parent_id: row.parent_id === null ? null : CommentId(row.parent_id),
  };
}

@Injectable()
export class FeedRepository implements FeedRankingReadPort {
  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {}

  async list(input: {
    readonly limit: number;
    readonly authorId: UserIdType | null;
    readonly communityIds: readonly string[] | null;
    readonly sort: string;
  }): Promise<readonly FeedPostRecord[]> {
    const params: unknown[] = [];
    const conditions = ["status = 'visible'"];
    if (input.authorId !== null) {
      params.push(input.authorId);
      conditions.push(`author_id = $${params.length}`);
    }
    if (input.communityIds !== null) {
      params.push(input.communityIds);
      conditions.push(`community_id = any($${params.length}::uuid[])`);
    }
    const order =
      input.sort === "new"
        ? "created_at desc, id desc"
        : input.sort === "top"
          ? "(votes_up - votes_down) desc, id desc"
          : input.sort === "best"
            ? "coalesce((select best from post_score where post_id = feed_posts.id), 0) desc, id desc"
            : input.sort === "controversial"
              ? "coalesce((select controversial from post_score where post_id = feed_posts.id), 0) desc, id desc"
              : "coalesce((select hot from post_score where post_id = feed_posts.id), 0) desc, id desc";
    params.push(input.limit);
    const result = await this.pool.query<PostRow>(`select ${POST_FIELDS} from feed_posts where ${conditions.join(" and ")} order by ${order} limit $${params.length}`, params);
    return result.rows.map(post);
  }

  async findVisible(postId: FeedPostId): Promise<FeedPostRecord | null> {
    const result = await this.pool.query<PostRow>(`select ${POST_FIELDS} from feed_posts where id = $1 and status = 'visible'`, [postId]);
    return result.rows[0] === undefined ? null : post(result.rows[0]);
  }

  async topScores(postIds: readonly FeedPostId[], window: string): Promise<ReadonlyMap<FeedPostId, number>> {
    if (postIds.length === 0) return new Map();
    const rows = (await this.pool.query<{ post_id: string; score: number }>(`select post_id,score from post_score where post_id=any($1::uuid[]) and window=$2`, [postIds, window]))
      .rows;
    return new Map(rows.map((row) => [FeedPostId(row.post_id), Number(row.score)]));
  }

  async coldCommunityFreshPostIds(postIds: readonly FeedPostId[], windowDays: number, postThreshold: number, freshHours: number): Promise<ReadonlySet<FeedPostId>> {
    if (postIds.length === 0) return new Set();
    const rows = (
      await this.pool.query<{ id: string }>(
        `select fp.id from feed_posts fp
       where fp.id=any($1::uuid[]) and fp.community_id is not null
         and fp.created_at>=now()-($4::int*interval '1 hour')
         and (select count(*) from feed_posts recent where recent.community_id=fp.community_id and recent.status='visible' and recent.created_at>=now()-($2::int*interval '1 day'))<$3`,
        [postIds, windowDays, postThreshold, freshHours],
      )
    ).rows;
    return new Set(rows.map((row) => FeedPostId(row.id)));
  }

  async find(postId: FeedPostId): Promise<FeedPostRecord | null> {
    const result = await this.pool.query<PostRow>(`select ${POST_FIELDS} from feed_posts where id = $1`, [postId]);
    return result.rows[0] === undefined ? null : post(result.rows[0]);
  }

  async create(input: {
    readonly actorId: UserIdType;
    readonly coAuthorAgentId: string | null;
    readonly communityId: string | null;
    readonly type: FeedPostType | "make";
    readonly title: string;
    readonly body: string | null;
    readonly modelId: string | null;
    readonly makeId?: string | null;
    readonly mediaKey: string | null;
    readonly posterKey: string | null;
    readonly gitverseUrl: string | null;
    readonly gitverseMeta: unknown;
    readonly status?: "draft" | "visible";
    readonly provenance?: {
      readonly sourceUrl: string;
      readonly sourceFingerprint: string;
      readonly provider: string;
      readonly model: string;
      readonly promptVersion: string;
    };
  }): Promise<FeedPostRecord> {
    const provenance = input.provenance;
    const result = await this.pool.query<PostRow>(
      `insert into feed_posts (
         author_id, co_author_agent_id, community_id, type, title, body, model_id, media_s3_key,
         make_id, poster_s3_key, gitverse_url, gitverse_meta, status, source_url, source_fingerprint,
         ingest_provider, ingest_model, ingest_prompt_version
       ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
       returning ${POST_FIELDS}`,
      [
        input.actorId,
        input.coAuthorAgentId,
        input.communityId,
        input.type,
        input.title,
        input.body,
        input.modelId,
        input.mediaKey,
        input.makeId ?? null,
        input.posterKey,
        input.gitverseUrl,
        input.gitverseMeta === null ? null : JSON.stringify(input.gitverseMeta),
        input.status ?? "visible",
        provenance?.sourceUrl ?? null,
        provenance?.sourceFingerprint ?? null,
        provenance?.provider ?? null,
        provenance?.model ?? null,
        provenance?.promptVersion ?? null,
      ],
    );
    return post(result.rows[0]!);
  }

  async ingest(input: {
    readonly actorId: UserIdType;
    readonly communityId: string;
    readonly type: FeedPostType;
    readonly title: string;
    readonly body: string | null;
    readonly mediaKey: string | null;
    readonly sourceUrl: string;
    readonly sourceFingerprint: string;
    readonly provider: string;
    readonly model: string;
    readonly promptVersion: string;
    readonly publish: boolean;
  }): Promise<{ readonly row: FeedPostRecord; readonly replay: boolean; readonly publishedNow: boolean }> {
    const inserted = await this.pool.query<PostRow>(
      `insert into feed_posts (
         author_id, community_id, type, title, body, media_s3_key, status,
         source_url, source_fingerprint, ingest_provider, ingest_model, ingest_prompt_version
       ) values ($1,$2,$3,$4,$5,$6,'draft',$7,$8,$9,$10,$11)
       on conflict (community_id, source_fingerprint) where source_fingerprint is not null do nothing
       returning ${POST_FIELDS}`,
      [
        input.actorId,
        input.communityId,
        input.type,
        input.title,
        input.body,
        input.mediaKey,
        input.sourceUrl,
        input.sourceFingerprint,
        input.provider,
        input.model,
        input.promptVersion,
      ],
    );
    const created = inserted.rows[0];
    if (created !== undefined) return { row: post(created), replay: false, publishedNow: false };
    if (input.publish) {
      const published = await this.pool.query<PostRow>(
        `update feed_posts set status = 'visible', updated_at = now()
         where community_id = $1 and source_fingerprint = $2 and status = 'draft'
         returning ${POST_FIELDS}`,
        [input.communityId, input.sourceFingerprint],
      );
      if (published.rows[0] !== undefined) return { row: post(published.rows[0]), replay: true, publishedNow: true };
    }
    const existing = await this.pool.query<PostRow>(`select ${POST_FIELDS} from feed_posts where community_id = $1 and source_fingerprint = $2`, [
      input.communityId,
      input.sourceFingerprint,
    ]);
    return { row: post(existing.rows[0]!), replay: true, publishedNow: false };
  }

  async patch(postId: FeedPostId, title: string | undefined, body: string | undefined): Promise<FeedPostRecord> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const before = await client.query<{ body: string | null }>(`select body from feed_posts where id = $1 for update`, [postId]);
      if (body !== undefined && before.rows[0]?.body !== body) {
        await client.query(`insert into feed_post_revisions (post_id, body) values ($1, $2)`, [postId, before.rows[0]?.body]);
      }
      const updated = await client.query<PostRow>(
        `update feed_posts set
           title = coalesce($2, title), body = coalesce($3, body),
           is_edited = true, edited_at = now(), updated_at = now()
         where id = $1 returning ${POST_FIELDS}`,
        [postId, title ?? null, body ?? null],
      );
      await client.query("commit");
      return post(updated.rows[0]!);
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async softDelete(postId: FeedPostId): Promise<void> {
    await this.pool.query(`update feed_posts set status = 'deleted', updated_at = now() where id = $1`, [postId]);
  }

  async comments(postId: FeedPostId, limit: number): Promise<readonly FeedCommentRecord[]> {
    const result = await this.pool.query<CommentRow>(
      `select id, user_id, parent_id, body, votes_up, votes_down, created_at
       from comments where subject_type = 'feed_post' and subject_id = $1 and deleted_at is null
       order by created_at desc, id desc limit $2`,
      [postId, limit],
    );
    return result.rows.map(comment);
  }

  async findComment(commentId: CommentId): Promise<(FeedCommentRecord & { readonly subject_id: FeedPostId }) | null> {
    const result = await this.pool.query<CommentRow & { subject_id: string }>(
      `select id, user_id, parent_id, body, votes_up, votes_down, created_at, subject_id
       from comments where id = $1 and subject_type = 'feed_post' and deleted_at is null`,
      [commentId],
    );
    const row = result.rows[0];
    return row === undefined ? null : { ...comment(row), subject_id: FeedPostId(row.subject_id) };
  }

  async createComment(postId: FeedPostId, userId: UserIdType, body: string, parentId: CommentId | null): Promise<FeedCommentRecord> {
    return this.transaction(async (client) => {
      const inserted = await client.query<CommentRow>(
        `insert into comments (subject_type, subject_id, user_id, parent_id, body)
         values ('feed_post', $1, $2, $3, $4)
         returning id, user_id, parent_id, body, votes_up, votes_down, created_at`,
        [postId, userId, parentId, body],
      );
      await client.query(`update feed_posts set comments_count = comments_count + 1 where id = $1`, [postId]);
      return comment(inserted.rows[0]!);
    });
  }

  async createOwnedComment(input: {
    readonly subjectType: "feed_post" | "model" | "make";
    readonly subjectId: string;
    readonly userId: UserIdType;
    readonly body: string;
    readonly parentId: CommentId | null;
  }): Promise<FeedCommentRecord> {
    const result = await this.pool.query<CommentRow>(
      `insert into comments (subject_type, subject_id, user_id, parent_id, body)
       values ($1, $2, $3, $4, $5)
       returning id, user_id, parent_id, body, votes_up, votes_down, created_at`,
      [input.subjectType, input.subjectId, input.userId, input.parentId, input.body],
    );
    return comment(result.rows[0]!);
  }

  async polymorphicComments(subjectType: "model" | "make", subjectId: string): Promise<readonly FeedCommentRecord[]> {
    const result = await this.pool.query<CommentRow>(
      `select id, user_id, parent_id, body, votes_up, votes_down, created_at
       from comments where subject_type = $1 and subject_id = $2 and deleted_at is null
       order by created_at asc, id asc`,
      [subjectType, subjectId],
    );
    return result.rows.map(comment);
  }

  async polymorphicCommentsWithDeleted(subjectType: "model" | "make", subjectId: string): Promise<readonly FeedModerationComment[]> {
    const rows = (
      await this.pool.query<{
        id: string;
        user_id: string;
        parent_id: string | null;
        body: string;
        created_at: Date;
        deleted_at: Date | null;
        deleted_by_owner: boolean | null;
      }>(
        `select id, user_id, parent_id, body, created_at, deleted_at, deleted_by_owner
         from comments where subject_type = $1 and subject_id = $2 order by created_at asc, id asc`,
        [subjectType, subjectId],
      )
    ).rows;
    return rows.map((row) => ({
      id: CommentId(row.id),
      userId: UserId(row.user_id),
      parentId: row.parent_id === null ? null : CommentId(row.parent_id),
      body: row.body,
      createdAt: row.created_at,
      deletedAt: row.deleted_at,
      deletedByOwner: row.deleted_by_owner === true,
    }));
  }

  async findPolymorphicComment(subjectType: "model" | "make", subjectId: string, commentId: CommentId): Promise<FeedModerationComment | null> {
    const row = (
      await this.pool.query<{
        id: string;
        user_id: string;
        parent_id: string | null;
        body: string;
        created_at: Date;
        deleted_at: Date | null;
        deleted_by_owner: boolean | null;
      }>(
        `select id, user_id, parent_id, body, created_at, deleted_at, deleted_by_owner
         from comments where id = $1 and subject_type = $2 and subject_id = $3 and deleted_at is null`,
        [commentId, subjectType, subjectId],
      )
    ).rows[0];
    return row === undefined
      ? null
      : {
          id: CommentId(row.id),
          userId: UserId(row.user_id),
          parentId: row.parent_id === null ? null : CommentId(row.parent_id),
          body: row.body,
          createdAt: row.created_at,
          deletedAt: row.deleted_at,
          deletedByOwner: row.deleted_by_owner === true,
        };
  }

  async polymorphicParentExists(subjectType: "model" | "make", subjectId: string, parentId: CommentId): Promise<boolean> {
    const result = await this.pool.query(`select 1 from comments where id = $1 and subject_type = $2 and subject_id = $3 and deleted_at is null`, [
      parentId,
      subjectType,
      subjectId,
    ]);
    return result.rowCount !== 0;
  }

  async findModelLinkPost(modelId: ModelId): Promise<FeedPostId | null> {
    const result = await this.pool.query<{ id: string }>(
      `select id from feed_posts where model_id = $1 and type = 'model_link' and status = 'visible' order by created_at asc limit 1`,
      [modelId],
    );
    return result.rows[0] === undefined ? null : FeedPostId(result.rows[0].id);
  }

  async ensureModelLinkPost(modelId: ModelId, authorId: UserIdType, title: string): Promise<void> {
    await this.pool.query(
      `insert into feed_posts (author_id, type, title, model_id)
       select $1, 'model_link', $2, $3
       where not exists (select 1 from feed_posts where model_id = $3 and type = 'model_link')`,
      [authorId, title, modelId],
    );
  }

  async deleteModelLinkPost(modelId: ModelId): Promise<void> {
    await this.pool.query(`delete from feed_posts where model_id = $1 and type = 'model_link'`, [modelId]);
  }

  async insertCommentInTransaction(
    client: PoolClient,
    input: {
      readonly subjectType: "model" | "make";
      readonly subjectId: string;
      readonly userId: UserIdType;
      readonly parentId: CommentId | null;
      readonly body: string;
    },
  ) {
    const result = await client.query<{
      id: string;
      parent_id: string | null;
      body: string;
      created_at: Date;
      deleted_at: Date | null;
      deleted_by_owner: boolean | null;
      author_id: string;
    }>(
      `insert into comments (subject_type, subject_id, user_id, parent_id, body)
       values ($1, $2, $3, $4, $5)
       returning id, parent_id, body, created_at, deleted_at, deleted_by_owner, user_id author_id`,
      [input.subjectType, input.subjectId, input.userId, input.parentId, input.body],
    );
    return result.rows[0]!;
  }

  async markCommentDeletedInTransaction(client: PoolClient, commentId: string, deletedByOwner: boolean): Promise<void> {
    await client.query(`update comments set deleted_at = now(), deleted_by_owner = $2 where id = $1`, [commentId, deletedByOwner]);
  }

  async softDeleteCommentsForSubject(subjectType: "feed_post" | "model" | "make", subjectId: string): Promise<void> {
    await this.pool.query(`update comments set deleted_at = now() where subject_type = $1 and subject_id = $2 and deleted_at is null`, [subjectType, subjectId]);
  }

  async deleteComment(commentId: CommentId, postId: FeedPostId): Promise<void> {
    await this.transaction(async (client) => {
      await client.query(`update comments set deleted_at = now() where id = $1`, [commentId]);
      await client.query(`update feed_posts set comments_count = greatest(comments_count - 1, 0) where id = $1`, [postId]);
    });
  }

  async updateVoteCounts(subjectType: "feed_post" | "feed_comment", subjectId: string, up: number, down: number, upWeighted: number, downWeighted: number): Promise<void> {
    if (subjectType === "feed_post") {
      await this.pool.query(`update feed_posts set votes_up = $2, votes_down = $3, votes_up_weighted = $4, votes_down_weighted = $5 where id = $1`, [
        subjectId,
        up,
        down,
        upWeighted,
        downWeighted,
      ]);
      await this.pool.query(`select pg_notify('post_score_recompute', $1)`, [subjectId]);
    } else {
      await this.pool.query(`update comments set votes_up = $2, votes_down = $3, votes_up_weighted = $4, votes_down_weighted = $5 where id = $1`, [
        subjectId,
        up,
        down,
        upWeighted,
        downWeighted,
      ]);
    }
  }

  async save(userId: UserIdType, postId: FeedPostId): Promise<boolean> {
    const result = await this.pool.query(`insert into feed_post_saves (user_id, post_id) values ($1, $2) on conflict do nothing returning post_id`, [userId, postId]);
    return (result.rowCount ?? 0) > 0;
  }

  async unsave(userId: UserIdType, postId: FeedPostId): Promise<void> {
    await this.pool.query(`delete from feed_post_saves where user_id = $1 and post_id = $2`, [userId, postId]);
  }

  async recordSignal(postId: FeedPostId, userId: UserIdType, eventType: string, props: Readonly<Record<string, unknown>>): Promise<void> {
    await this.pool.query(`insert into feed_events (post_id, user_id, event_type, props) values ($1, $2, $3, $4)`, [postId, userId, eventType, JSON.stringify(props)]);
  }

  async addImage(postId: FeedPostId, id: string, key: string): Promise<void> {
    await this.pool.query(`insert into feed_post_images (id, post_id, s3_key) values ($1, $2, $3)`, [id, postId, key]);
  }

  async imageKey(postId: FeedPostId, fileId: string): Promise<string | null> {
    const result = await this.pool.query<{ s3_key: string }>(`select s3_key from feed_post_images where id = $1 and post_id = $2`, [fileId, postId]);
    return result.rows[0]?.s3_key ?? null;
  }

  private async transaction<T>(operation: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const result = await operation(client);
      await client.query("commit");
      return result;
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }
}
