import { ForbiddenException, HttpException, HttpStatus, Inject, Injectable, NotFoundException, UnprocessableEntityException } from "@nestjs/common";
import { IdeaId, type IdeaId as IdeaIdType, type UserId } from "../../_kernel/brandedIds.ts";
import {
  computeTrendScore,
  decodeCursor,
  encodeCursor,
  IDEA_BODY_MAX_LENGTH,
  IDEA_CATEGORIES,
  IDEA_COMMENT_MAX_LENGTH,
  IDEA_ENRICH_FREE_TEXT_MAX_LENGTH,
  IDEA_MODERATION_STATUSES,
  IDEA_ORIGIN_SOURCES,
  IDEA_STATUSES,
  IDEA_STATUSES_REQUIRING_REASON,
  IDEA_TITLE_MAX_LENGTH,
  IDEA_TYPES,
  parseLimit,
  type Idea,
  type IdeaOrigin,
  type IdeaStatus,
} from "../domain/ideas.ts";
import { IdeasRepository } from "../infrastructure/ideas.repository.ts";
import {
  IDEAS_ENRICHMENT_PORT,
  IDEAS_STAFF_PORT,
  IDEAS_PUSH_PORT,
  IDEAS_RATE_LIMIT_PORT,
  IDEAS_VERIFIED_IDENTITY_PORT,
  type CreateIdeaInput,
  type IdeaListQuery,
  type IdeasEnrichmentPort,
  type IdeasPort,
  type IdeasPushPort,
  type IdeasRateLimitIdentity,
  type IdeasRateLimitPort,
  type IdeasStaffPort,
  type IdeasVerifiedIdentityPort,
} from "../public/index.ts";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STATUS_TITLES: Record<IdeaStatus, string> = {
  proposed: "Идея принята к рассмотрению",
  under_review: "Идея на рассмотрении",
  planned: "Идея запланирована",
  in_progress: "Идея в работе",
  done: "Идея готова",
  declined: "Идея отклонена",
  duplicate: "Идея помечена как дубликат",
  archived: "Идея архивирована",
  hidden: "Идея скрыта модерацией",
  removed: "Идея удалена модерацией",
};

function includes<T extends string>(values: readonly T[], value: unknown): value is T {
  return typeof value === "string" && values.includes(value as T);
}

function invalid(): never {
  throw new UnprocessableEntityException();
}

function parseOrigin(value: unknown): IdeaOrigin | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "object" || Array.isArray(value)) return invalid();
  const raw = value as Record<string, unknown>;
  if (!includes(IDEA_ORIGIN_SOURCES, raw.source)) return invalid();
  const origin: { source: IdeaOrigin["source"]; ref_id?: string; ref_url?: string; query?: string } = { source: raw.source };
  for (const key of ["ref_id", "ref_url", "query"] as const) {
    const field = raw[key];
    if (field === undefined) continue;
    if (typeof field !== "string" || field.length > 500) return invalid();
    if (field.length > 0) origin[key] = field;
  }
  return origin;
}

function assertUuid(raw: string): IdeaIdType {
  if (!UUID_RE.test(raw)) throw new NotFoundException();
  return IdeaId(raw);
}

@Injectable()
export class IdeasService implements IdeasPort {
  constructor(
    @Inject(IdeasRepository) private readonly repository: IdeasRepository,
    @Inject(IDEAS_STAFF_PORT) private readonly staff: IdeasStaffPort,
    @Inject(IDEAS_VERIFIED_IDENTITY_PORT) private readonly identities: IdeasVerifiedIdentityPort,
    @Inject(IDEAS_PUSH_PORT) private readonly push: IdeasPushPort,
    @Inject(IDEAS_ENRICHMENT_PORT) private readonly enrichment: IdeasEnrichmentPort,
    @Inject(IDEAS_RATE_LIMIT_PORT) private readonly rateLimit: IdeasRateLimitPort,
  ) {}

  async list(query: IdeaListQuery): Promise<{ readonly items: readonly Idea[]; readonly next_cursor: string | null }> {
    if (query.category !== undefined && !includes(IDEA_CATEGORIES, query.category)) invalid();
    if (query.status !== undefined && !includes(IDEA_STATUSES, query.status)) invalid();
    if (query.type !== undefined && !includes(IDEA_TYPES, query.type)) invalid();
    const limit = parseLimit(query.limit, 24, 60);
    const tab = query.tab === "popular" || query.tab === "trending" ? query.tab : "new";
    const cursor = decodeCursor(query.cursor, tab === "popular" ? 3 : 2);
    const rows = await this.repository.list({
      type: query.type ?? "idea",
      category: query.category,
      status: query.status,
      tab,
      cursor,
      limit,
    });

    if (tab === "trending") {
      const items = rows
        .map((row) => ({ row, score: computeTrendScore(row.vote_count, row.created_at) }))
        .sort((left, right) => right.score - left.score)
        .slice(0, limit)
        .map(({ row }) => row);
      await this.applyClusterCounts(items);
      return { items, next_cursor: null };
    }

    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    const last = items.at(-1);
    const next_cursor =
      hasMore && last !== undefined ? encodeCursor(tab === "popular" ? [last.vote_count, last.created_at.toISOString(), last.id] : [last.created_at.toISOString(), last.id]) : null;
    await this.applyClusterCounts(items);
    return { items, next_cursor };
  }

  async mine(userId: UserId, query: Pick<IdeaListQuery, "cursor" | "limit">) {
    const limit = parseLimit(query.limit, 24, 60);
    const rows = await this.repository.mine(userId, decodeCursor(query.cursor, 2), limit);
    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    const last = items.at(-1);
    return {
      items,
      next_cursor: hasMore && last !== undefined ? encodeCursor([last.created_at.toISOString(), last.id]) : null,
    };
  }

  async detail(id: IdeaIdType, viewerId: UserId | null) {
    const parts = await this.repository.detailParts(id, viewerId);
    if (parts.idea === null) throw new NotFoundException();
    await this.applyClusterCounts([parts.idea]);
    return {
      ...parts.idea,
      viewer_has_voted: parts.viewerHasVoted,
      comments: parts.comments.map(({ idea_id: _ideaId, ...item }) => item),
    };
  }

  async top(_userId: UserId, query: Pick<IdeaListQuery, "category" | "status" | "limit">) {
    if (query.category !== undefined && !includes(IDEA_CATEGORIES, query.category)) invalid();
    if (query.status !== undefined && !includes(IDEA_STATUSES, query.status)) invalid();
    const rows = await this.repository.top(query.category, query.status, parseLimit(query.limit, 10, 50));
    const base = (process.env.WEB_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
    return {
      items: rows.map((row) => ({
        id: row.id,
        title: row.title,
        category: row.category,
        status: row.status,
        vote_count: row.vote_count,
        trend_score: computeTrendScore(row.vote_count, row.created_at),
        url: `${base}/issue/${row.id}`,
      })),
    };
  }

  async similar(_userId: UserId, raw: string | undefined) {
    const query = raw?.trim();
    return { items: query ? await this.repository.similar(query) : [] };
  }

  async create(userId: UserId, identity: IdeasRateLimitIdentity, input: CreateIdeaInput) {
    if (await this.rateLimit.isLimited("idea_create", identity)) throw new HttpException("", HttpStatus.TOO_MANY_REQUESTS);
    if (typeof input.title !== "string" || input.title.trim().length === 0) invalid();
    const title = input.title.trim();
    if (title.length > IDEA_TITLE_MAX_LENGTH) invalid();
    if (typeof input.body !== "string" || input.body.trim().length === 0 || input.body.length > IDEA_BODY_MAX_LENGTH) invalid();
    if (!includes(IDEA_CATEGORIES, input.category)) invalid();
    const type = input.type === undefined ? "idea" : input.type;
    if (!includes(IDEA_TYPES, type)) invalid();
    if (input.ai_assisted !== undefined && typeof input.ai_assisted !== "boolean") invalid();
    const result = await this.repository.createWithinQuota(userId, {
      title,
      body: input.body,
      category: input.category,
      type,
      origin: parseOrigin(input.origin),
      aiAssisted: input.ai_assisted === true,
    });
    if (result.kind === "limited") throw new HttpException("", HttpStatus.TOO_MANY_REQUESTS);
    return { ...result.idea, quota_remaining: result.remaining };
  }

  async enrich(userId: UserId, identity: IdeasRateLimitIdentity, freeText: unknown) {
    if (await this.rateLimit.isLimited("idea_enrich", identity)) throw new HttpException("", HttpStatus.TOO_MANY_REQUESTS);
    if (typeof freeText !== "string" || freeText.trim().length === 0) invalid();
    const text = freeText.trim();
    if (text.length > IDEA_ENRICH_FREE_TEXT_MAX_LENGTH) throw new HttpException("", HttpStatus.PAYLOAD_TOO_LARGE);
    if (!(await this.repository.consumeEnrichmentQuota(userId))) throw new HttpException("", HttpStatus.TOO_MANY_REQUESTS);
    const result = await this.enrichment.enrich(text);
    if (!result.ok) throw new HttpException("", HttpStatus.SERVICE_UNAVAILABLE);
    if (typeof result.draft.title !== "string" || result.draft.title.length > IDEA_TITLE_MAX_LENGTH) {
      throw new HttpException("", HttpStatus.BAD_GATEWAY);
    }
    if (!includes(IDEA_CATEGORIES, result.draft.category)) throw new HttpException("", HttpStatus.BAD_GATEWAY);
    return {
      title: result.draft.title,
      body: typeof result.draft.body === "string" ? result.draft.body : "",
      category: result.draft.category,
    };
  }

  async toggleVote(userId: UserId, id: IdeaIdType) {
    if (!(await this.identities.hasVerifiedIdentity(userId))) throw new ForbiddenException();
    if (!UUID_RE.test(id)) throw new NotFoundException();
    const result = await this.repository.toggleVote(userId, id);
    if (!result.exists) throw new NotFoundException();
    const clustered = await this.repository.clusterVoteCounts([id]);
    return { vote_count: clustered.get(id) ?? result.voteCount, viewer_has_voted: result.hasVoted };
  }

  async comments(id: IdeaIdType, cursor: string | undefined, rawLimit: string | undefined) {
    const limit = parseLimit(rawLimit, 30, 100);
    const rows = await this.repository.comments(id, cursor ?? null, limit);
    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    return { items, next_cursor: hasMore ? (items.at(-1)?.created_at.toISOString() ?? null) : null };
  }

  async comment(userId: UserId, id: IdeaIdType, rawBody: unknown) {
    if (typeof rawBody !== "string" || rawBody.trim().length === 0 || rawBody.length > IDEA_COMMENT_MAX_LENGTH) invalid();
    const created = await this.repository.addComment(userId, id, rawBody);
    if (created === null) throw new NotFoundException();
    if (created.authorId !== userId) {
      void this.push.commentCreated({ recipientId: created.authorId, ideaId: id, ideaTitle: created.title }).catch(() => undefined);
    }
    return created.comment;
  }

  async changeStatus(actorId: UserId, id: IdeaIdType, input: { readonly status?: unknown; readonly decline_reason?: unknown; readonly canonical_id?: unknown }) {
    if (!(await this.staff.isStaff(actorId))) throw new ForbiddenException();
    if (!UUID_RE.test(id)) throw new NotFoundException();
    if (!includes(IDEA_STATUSES, input.status) || IDEA_MODERATION_STATUSES.has(input.status)) invalid();
    const reason = typeof input.decline_reason === "string" && input.decline_reason.trim() ? input.decline_reason.trim() : null;
    if (IDEA_STATUSES_REQUIRING_REASON.has(input.status) && reason === null) invalid();
    let canonicalId: IdeaIdType | null = null;
    if (input.status === "duplicate") {
      if (typeof input.canonical_id !== "string" || input.canonical_id === id || !UUID_RE.test(input.canonical_id)) invalid();
      if (!(await this.repository.canonicalExists(input.canonical_id))) invalid();
      canonicalId = IdeaId(input.canonical_id);
    }
    const changed = await this.repository.changeStatus(id, input.status, reason, canonicalId);
    if (changed === null) throw new NotFoundException();
    await this.repository.notifyStatus(id, changed.authorId, input.status, reason, STATUS_TITLES[input.status]);
    return { id, status: input.status, decline_reason: reason, canonical_id: canonicalId };
  }

  async moderate(actorId: UserId, id: IdeaIdType, input: { readonly action?: unknown; readonly reason?: unknown }) {
    if (!(await this.staff.isStaff(actorId))) throw new ForbiddenException();
    if (!UUID_RE.test(id)) throw new NotFoundException();
    if (!includes(["hide", "unhide", "remove"] as const, input.action)) invalid();
    const reason = typeof input.reason === "string" && input.reason.trim() ? input.reason.trim() : null;
    const status = await this.repository.moderate(id, input.action, reason);
    if (status === null) throw new NotFoundException();
    if (status === "not_hidden") invalid();
    return { id, status };
  }

  private async applyClusterCounts(items: Idea[]): Promise<void> {
    const counts = await this.repository.clusterVoteCounts(items.map((item) => item.id));
    for (const item of items) item.vote_count = counts.get(item.id) ?? item.vote_count;
  }
}

export { assertUuid };
