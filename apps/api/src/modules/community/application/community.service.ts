import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { UserId } from "../../_kernel/brandedIds.ts";
import { CommunityRepository } from "../infrastructure/community.repository.ts";
import {
  COMMUNITY_DESCRIPTION_MAX_LENGTH,
  COMMUNITY_NAME_MAX_LENGTH,
  MAX_MODEL_ATTACHMENT_BYTES,
  MAX_PHOTO_ATTACHMENT_BYTES,
  MAX_POST_ATTACHMENTS,
  POST_CONTENT_MAX_LENGTH,
  roundMemberCount,
  slugify,
  THREAD_CONTENT_MAX_LENGTH,
  THREAD_TITLE_MAX_LENGTH,
  type CommunityRole,
  type PostKind,
  type SubscribeSource,
  type ThreadType,
} from "../domain/community.ts";
import {
  COMMUNITY_ANALYTICS_PORT,
  COMMUNITY_CATALOG_PORT,
  COMMUNITY_FEED_PORT,
  COMMUNITY_MODELS_PORT,
  COMMUNITY_PROFILE_PORT,
  COMMUNITY_REPUTATION_PORT,
  COMMUNITY_STORAGE_PORT,
  type AttachmentView,
  type CommunityAnalyticsPort,
  type CommunityCatalogPort,
  type CommunityFeedPort,
  type CommunityModelsPort,
  type CommunityPort,
  type CommunityProfilePort,
  type CommunityRecord,
  type CommunityReputationPort,
  type CommunityStoragePort,
  type CommunityView,
  type PostRecord,
  type PostView,
  type ResolvedModel,
  type ThreadRecord,
  type ThreadView,
} from "./community.ports.ts";
import type { CommunitySocialOwnerPort } from "../public/index.ts";

const fail = (status: number): never => {
  throw status === 404
    ? new NotFoundException()
    : status === 403
      ? new ForbiddenException()
      : status === 409
        ? new ConflictException()
        : status === 422
          ? new UnprocessableEntityException()
          : new BadRequestException();
};
const found = <T>(value: T | null): T => {
  if (value === null) throw new NotFoundException();
  return value;
};
const threadView = (r: ThreadRecord, tags: string[] = []): ThreadView => ({ ...r, post_count: Number(r.post_count), tags });
const communityView = (r: CommunityRecord, role: CommunityRole | null = null): CommunityView => ({
  ...r,
  is_official: r.kind === "machine" || r.kind === "vendor",
  cover_image_url: r.cover_image_s3_key,
  member_count: role === "owner" || role === "moderator" ? Number(r.member_count) : roundMemberCount(Number(r.member_count)),
  thread_count: Number(r.thread_count),
  viewer_role: role,
});
const postView = (r: PostRecord, accepted = false, attachments: readonly AttachmentView[] = [], resolved_models: readonly ResolvedModel[] = []): PostView => ({
  ...r,
  is_accepted: accepted,
  attachments,
  resolved_models,
});

@Injectable()
export class CommunityService implements CommunityPort, CommunitySocialOwnerPort {
  constructor(
    @Inject(CommunityRepository) private readonly repo: CommunityRepository,
    @Inject(COMMUNITY_FEED_PORT) private readonly feedPort: CommunityFeedPort,
    @Inject(COMMUNITY_CATALOG_PORT) private readonly catalog: CommunityCatalogPort,
    @Inject(COMMUNITY_MODELS_PORT) private readonly models: CommunityModelsPort,
    @Inject(COMMUNITY_PROFILE_PORT) private readonly profile: CommunityProfilePort,
    @Inject(COMMUNITY_ANALYTICS_PORT) private readonly analytics: CommunityAnalyticsPort,
    @Inject(COMMUNITY_REPUTATION_PORT) private readonly reputation: CommunityReputationPort,
    @Inject(COMMUNITY_STORAGE_PORT) private readonly storage: CommunityStoragePort,
  ) {}
  async create(i: { name: string; slug: string; description: string | null; visibility: string; tagIds: readonly string[]; userId: UserId }) {
    if (!i.name.trim() || i.name.trim().length > COMMUNITY_NAME_MAX_LENGTH || (i.description && i.description.length > COMMUNITY_DESCRIPTION_MAX_LENGTH)) fail(422);
    const base = i.slug || slugify(i.name) || "club";
    try {
      return communityView(await this.repo.create({ ...i, name: i.name.trim(), slug: i.slug || (await this.repo.uniqueSlug(base)) }), "owner");
    } catch (e) {
      if ((e as { code?: string }).code === "23505") fail(409);
      if ((e as { code?: string }).code === "INVALID_TAG_IDS") fail(422);
      throw e;
    }
  }
  async list(i: Parameters<CommunityPort["list"]>[0]) {
    const rows = await this.catalog.enrich(await this.repo.list(i));
    const has = rows.length > i.limit,
      items = has ? rows.slice(0, i.limit) : rows;
    return { items: items.map((x) => communityView(x)), next_cursor: has ? items.at(-1)!.created_at.toISOString() : null };
  }
  async detail(id: string, userId: UserId) {
    const row = found(await this.repo.community(id));
    const [role, related, enriched] = await Promise.all([this.repo.role(row.id, userId), this.catalog.related(row.id), this.catalog.enrich([row])]);
    return { ...communityView(enriched[0] ?? row, role), related_communities: related };
  }
  async join(id: string, u: UserId) {
    const role = found(await this.repo.join(id, u));
    return { role };
  }
  async leave(id: string, u: UserId) {
    const r = await this.repo.leave(id, u);
    if (r === "not_found") fail(404);
    if (r === "last_owner") fail(409);
    return { left: true as const };
  }
  async subscribe(id: string, u: UserId, s: SubscribeSource | null) {
    const out = await this.join(id, u);
    await this.analytics.subscription({ userId: u, communityId: id, kind: await this.repo.kind(id), action: "subscribed", source: s });
    return out;
  }
  async unsubscribe(id: string, u: UserId, s: SubscribeSource | null) {
    const kind = await this.repo.kind(id),
      out = await this.leave(id, u);
    await this.analytics.subscription({ userId: u, communityId: id, kind, action: "unsubscribed", source: s });
    return out;
  }
  async setRole(id: string, t: UserId, a: UserId, role: CommunityRole) {
    const r = await this.repo.setRole(id, t, a, role);
    if (r === "owner_only") fail(403);
    if (r === "not_found") fail(404);
    if (r === "last_owner") fail(409);
    return { role };
  }
  async bootstrapOwner(id: string, t: UserId, a: UserId) {
    if (!(await this.profile.isStaff(a))) fail(403);
    if (!(await this.profile.exists(t))) fail(422);
    const r = await this.repo.bootstrap(id, t);
    if (r === "not_found") fail(404);
    if (r === "not_catalog") fail(422);
    if (r === "owner_exists") fail(409);
    return { role: "owner" as const, user_id: t };
  }
  async feed(id: string, sort: string, limit: number, cursor: string | null) {
    if (!(await this.repo.community(id))) fail(404);
    return this.feedPort.list({ communityId: id, sort, limit, cursor });
  }
  async createThread(id: string, u: UserId, i: { type: ThreadType; title: string; content: string; tags: string[] }) {
    if (!(await this.repo.community(id))) fail(404);
    if (!i.title.trim() || i.title.trim().length > THREAD_TITLE_MAX_LENGTH || !i.content.trim() || i.content.length > THREAD_CONTENT_MAX_LENGTH || i.tags.length > 5) fail(422);
    return threadView(await this.repo.createThread(id, u, i.type, i.title.trim(), i.content, [...new Set(i.tags.map((x) => x.trim().toLowerCase()).filter(Boolean))]), i.tags);
  }
  async threads(i: Parameters<CommunityPort["threads"]>[0]) {
    const rows = await this.repo.threads(i),
      has = rows.length > i.limit,
      items = has ? rows.slice(0, i.limit) : rows,
      tags = await this.repo.tags(items.map((x) => x.id));
    return { items: items.map((x) => threadView(x, tags.get(x.id))), next_cursor: has ? items.at(-1)!.created_at.toISOString() : null };
  }
  async thread(id: string) {
    const t = found(await this.repo.thread(id));
    const posts = await this.repo.posts(id, t.type === "question"),
      ids = posts.map((x) => x.id);
    const [tags, attachments, models] = await Promise.all([this.repo.tags([id]), this.repo.attachmentRows(ids), this.models.resolve(posts)]);
    return {
      thread: threadView(t, tags.get(id)),
      posts: posts.map((p) =>
        postView(
          p,
          p.id === t.accepted_post_id,
          (attachments.get(p.id) ?? []).map((a) => ({ id: a.id, kind: a.kind, url: `/posts/${p.id}/attachments/${a.id}`, size_bytes: a.size_bytes, created_at: a.created_at })),
          models.get(p.id) ?? [],
        ),
      ),
    };
  }
  async createPost(id: string, u: UserId, i: { kind: PostKind; content: string; parentPostId?: string }) {
    const t = found(await this.repo.thread(id));
    if (t.status !== "open") fail(409);
    const allowed = t.type === "question" ? ["answer", "comment"] : ["reply", "comment"];
    if (!allowed.includes(i.kind) || !i.content.trim() || i.content.length > POST_CONTENT_MAX_LENGTH) fail(422);
    if (i.parentPostId && !(await this.repo.posts(id, false)).some((p) => p.id === i.parentPostId)) fail(422);
    const p = await this.repo.createPost(id, u, i.parentPostId ?? null, i.kind, i.content),
      m = await this.models.resolve([p]);
    return postView(p, false, [], m.get(p.id) ?? []);
  }
  async voteThread(id: string, u: UserId, v: 1 | -1 | 0) {
    const t = found(await this.repo.thread(id));
    const r = await this.repo.vote("thread", id, u, v);
    if (r.isNew && v) this.reputation.threadVote({ id, authorId: t.author_id, type: t.type }, v).catch(() => undefined);
    return { votes_up: r.up, votes_down: r.down, my_vote: v };
  }
  async votePost(id: string, u: UserId, v: 1 | -1 | 0) {
    const p = found(await this.repo.post(id));
    const r = await this.repo.vote("post", id, u, v);
    if (r.isNew && v) this.reputation.postVote({ id, authorId: p.author_id, kind: p.kind }, v).catch(() => undefined);
    return { votes_up: r.up, votes_down: r.down, my_vote: v };
  }
  async uploadAttachment(id: string, u: UserId, file: { buffer: Buffer; originalname: string }) {
    if (!this.storage.configured()) throw new ServiceUnavailableException();
    const p = found(await this.repo.post(id));
    if (p.author_id !== u) fail(403);
    if (p.status !== "visible") fail(409);
    if ((await this.repo.attachmentCount(id)) >= MAX_POST_ATTACHMENTS) fail(400);
    const is3mf = file.buffer.subarray(0, 2).equals(Buffer.from("PK")),
      kind = is3mf ? "model_3mf" : "photo",
      limit = is3mf ? MAX_MODEL_ATTACHMENT_BYTES : MAX_PHOTO_ATTACHMENT_BYTES;
    if (file.buffer.length > limit) throw new HttpException({}, 413);
    const ext = is3mf ? "3mf" : "bin",
      mime = is3mf ? "model/3mf" : "application/octet-stream",
      key = `public/posts/${id}/${randomUUID()}.${ext}`;
    await this.storage.put(key, file.buffer, mime);
    const a = await this.repo.addAttachment(id, u, kind, key, file.buffer.length, file.originalname, mime);
    return { attachment: { id: a.id, kind: a.kind, url: `/posts/${id}/attachments/${a.id}`, size_bytes: a.size_bytes, created_at: a.created_at } };
  }
  async attachment(postId: string, id: string): Promise<{ kind: "photo" | "model_3mf"; key: string }> {
    const p = found(await this.repo.post(postId));
    if (p.status !== "visible") fail(404);
    const a = found(await this.repo.attachment(postId, id));
    if (a.kind === "photo" || a.kind === "model_3mf") return { kind: a.kind, key: a.s3_key };
    return fail(404);
  }
  async applyVote(subjectType: string, subjectId: string, userId: UserId, value: 1 | -1 | 0) {
    const r = await this.repo.socialVote(subjectType, subjectId, userId, value);
    return { votesUp: r.up, votesDown: r.down, isNewCast: r.isNew, castValue: r.isNew && value !== 0 ? value : null };
  }
  async togglePositiveVote(subjectType: string, subjectId: string, userId: UserId) {
    return this.repo.togglePositiveVote(subjectType, subjectId, userId);
  }
  async applyWeightedVote(subjectType: string, subjectId: string, userId: UserId, value: 1 | -1 | 0, trustSnapshot: number) {
    return this.repo.applyWeightedVote(subjectType, subjectId, userId, value, trustSnapshot);
  }
  async findTagIdByName(name: string) {
    return this.repo.findTagIdByName(name);
  }
  async accept(id: string, u: UserId, postId: string | null) {
    const t = found(await this.repo.thread(id));
    if (t.type !== "question") fail(409);
    if (t.author_id !== u) fail(403);
    if (postId === null) {
      await this.repo.accept(id, null);
      return { accepted_post_id: null };
    }
    const p = found(await this.repo.post(postId));
    if (p.thread_id !== id || p.kind !== "answer") fail(422);
    await this.repo.accept(id, postId);
    await this.reputation.accepted({ id: p.id, authorId: p.author_id });
    return { accepted_post_id: postId };
  }
}
