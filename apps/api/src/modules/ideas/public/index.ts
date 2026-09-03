import type { IdeaId, UserId } from "../../_kernel/brandedIds.ts";
import type { Idea, IdeaCategory, IdeaComment, IdeaOrigin, IdeaStatus, IdeaType } from "../domain/ideas.ts";

export const IDEAS_PORT = Symbol("IDEAS_PORT");
export const IDEAS_STAFF_PORT = Symbol("IDEAS_STAFF_PORT");
export const IDEAS_VERIFIED_IDENTITY_PORT = Symbol("IDEAS_VERIFIED_IDENTITY_PORT");

/** @deprecated Административные проверки выполняются через PermissionsService. */
export interface IdeasStaffPort {
  isStaff(userId: UserId): Promise<boolean>;
}
export const IDEAS_PUSH_PORT = Symbol("IDEAS_PUSH_PORT");
export const IDEAS_ENRICHMENT_PORT = Symbol("IDEAS_ENRICHMENT_PORT");
export const IDEAS_RATE_LIMIT_PORT = Symbol("IDEAS_RATE_LIMIT_PORT");

export interface IdeasVerifiedIdentityPort {
  hasVerifiedIdentity(userId: UserId): Promise<boolean>;
}

export interface IdeasPushPort {
  commentCreated(input: { readonly recipientId: UserId; readonly ideaId: IdeaId; readonly ideaTitle: string }): Promise<void>;
}

export interface IdeasEnrichmentPort {
  enrich(
    freeText: string,
  ): Promise<{ readonly ok: true; readonly draft: { readonly title: unknown; readonly body: unknown; readonly category: unknown } } | { readonly ok: false }>;
}

export type IdeasRateLimitScope = "idea_create" | "idea_enrich";
export interface IdeasRateLimitIdentity {
  readonly userId: UserId;
  readonly ip: string | null;
  readonly userAgent: string | null;
}
export interface IdeasRateLimitPort {
  isLimited(scope: IdeasRateLimitScope, identity: IdeasRateLimitIdentity): Promise<boolean>;
}

export interface IdeaListQuery {
  readonly tab?: string;
  readonly category?: string;
  readonly status?: string;
  readonly type?: string;
  readonly cursor?: string;
  readonly limit?: string;
}

export interface CreateIdeaInput {
  readonly title?: string;
  readonly body?: string;
  readonly category?: IdeaCategory;
  readonly type?: IdeaType;
  readonly origin?: IdeaOrigin;
  readonly ai_assisted?: boolean;
}

export interface IdeaTopItem {
  readonly id: IdeaId;
  readonly title: string;
  readonly category: string;
  readonly status: string;
  readonly vote_count: number;
  readonly trend_score: number;
  readonly url: string;
}
export interface IdeaSimilarItem {
  readonly id: IdeaId;
  readonly title: string;
  readonly vote_count: number;
  readonly status: string;
}

export interface IdeasPort {
  list(query: IdeaListQuery): Promise<{ readonly items: readonly Idea[]; readonly next_cursor: string | null }>;
  mine(userId: UserId, query: Pick<IdeaListQuery, "cursor" | "limit">): Promise<{ readonly items: readonly Idea[]; readonly next_cursor: string | null }>;
  detail(id: IdeaId, viewerId: UserId | null): Promise<Idea & { readonly viewer_has_voted: boolean; readonly comments: readonly Omit<IdeaComment, "idea_id">[] }>;
  top(userId: UserId, query: Pick<IdeaListQuery, "category" | "status" | "limit">): Promise<{ readonly items: readonly IdeaTopItem[] }>;
  similar(userId: UserId, query: string | undefined): Promise<{ readonly items: readonly IdeaSimilarItem[] }>;
  create(userId: UserId, identity: IdeasRateLimitIdentity, input: CreateIdeaInput): Promise<Idea & { readonly quota_remaining: number }>;
  enrich(
    userId: UserId,
    identity: IdeasRateLimitIdentity,
    freeText: string | undefined,
  ): Promise<{ readonly title: string; readonly body: string; readonly category: IdeaCategory }>;
  toggleVote(userId: UserId, id: IdeaId): Promise<{ readonly vote_count: number; readonly viewer_has_voted: boolean }>;
  comments(id: IdeaId, cursor: string | undefined, limit: string | undefined): Promise<{ readonly items: readonly IdeaComment[]; readonly next_cursor: string | null }>;
  comment(userId: UserId, id: IdeaId, body: string | undefined): Promise<IdeaComment>;
  changeStatus(
    actorId: UserId,
    id: IdeaId,
    input: { readonly status?: IdeaStatus; readonly decline_reason?: string | null; readonly canonical_id?: string | null },
  ): Promise<{ readonly id: IdeaId; readonly status: IdeaStatus; readonly decline_reason: string | null; readonly canonical_id: IdeaId | null }>;
  moderate(
    actorId: UserId,
    id: IdeaId,
    input: { readonly action?: "hide" | "remove" | "restore"; readonly reason?: string | null },
  ): Promise<{ readonly id: IdeaId; readonly status: IdeaStatus }>;
}

export type { Idea, IdeaCategory, IdeaComment, IdeaOrigin, IdeaStatus, IdeaType };
export { enrichIdeaDraft } from "../infrastructure/giga-client.ts";
