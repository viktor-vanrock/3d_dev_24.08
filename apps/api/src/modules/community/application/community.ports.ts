import type { Readable } from "node:stream";
import type { UserId } from "../../_kernel/brandedIds.ts";
import type { CommunityRole, PostKind, SubscribeSource, ThreadType } from "../domain/community.ts";
import type { FeedPostResponse } from "../../feed/public/index.ts";

export const COMMUNITY_FEED_PORT = Symbol("COMMUNITY_FEED_PORT");
export const COMMUNITY_CATALOG_PORT = Symbol("COMMUNITY_CATALOG_PORT");
export const COMMUNITY_MODELS_PORT = Symbol("COMMUNITY_MODELS_PORT");
export const COMMUNITY_PROFILE_PORT = Symbol("COMMUNITY_PROFILE_PORT");
export const COMMUNITY_ANALYTICS_PORT = Symbol("COMMUNITY_ANALYTICS_PORT");
export const COMMUNITY_REPUTATION_PORT = Symbol("COMMUNITY_REPUTATION_PORT");
export const COMMUNITY_STORAGE_PORT = Symbol("COMMUNITY_STORAGE_PORT");

export interface CommunityFeedPage {
  readonly items: readonly FeedPostResponse[];
  readonly next_cursor: string | null;
}
export interface CommunityFeedPort {
  list(input: { communityId: string; sort: string; limit: number; cursor: string | null }): Promise<CommunityFeedPage>;
}
export interface CommunityCatalogPort {
  enrich(rows: readonly CommunityRecord[]): Promise<readonly CommunityRecord[]>;
  related(communityId: string): Promise<readonly { id: string; slug: string; name: string; kind: string }[]>;
}
export interface ResolvedModel {
  id: string;
  title: string;
  thumbnail_url: string | null;
}
export interface CommunityModelsPort {
  resolve(posts: readonly { id: string; content: string }[]): Promise<ReadonlyMap<string, readonly ResolvedModel[]>>;
}
export interface CommunityProfilePort {
  isStaff(userId: UserId): Promise<boolean>;
  exists(userId: UserId): Promise<boolean>;
}
export interface CommunityAnalyticsPort {
  subscription(input: { userId: UserId; communityId: string; kind: string | null; action: "subscribed" | "unsubscribed"; source: SubscribeSource | null }): Promise<void>;
}
export interface CommunityReputationPort {
  postVote(post: { id: string; authorId: string; kind: PostKind }, value: 1 | -1): Promise<void>;
  threadVote(thread: { id: string; authorId: string; type: ThreadType }, value: 1 | -1): Promise<void>;
  accepted(post: { id: string; authorId: string }): Promise<void>;
}
export interface StoredObject {
  body: Readable;
  etag?: string;
  contentLength?: number;
}
export interface CommunityStoragePort {
  configured(): boolean;
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<StoredObject | null>;
  publicUrl(key: string): string | null;
}

export interface CommunityRecord {
  id: string;
  slug: string;
  name: string;
  kind: string;
  subject_type: string | null;
  subject_id: string | null;
  description: string | null;
  cover_image_s3_key: string | null;
  visibility: string;
  status: string;
  created_by: string | null;
  created_at: Date;
  member_count: string;
  thread_count: string;
  website: string | null;
}
export interface ThreadRecord {
  id: string;
  community_id: string;
  author_id: string;
  type: ThreadType;
  title: string;
  content: string;
  status: string;
  pinned: boolean;
  accepted_post_id: string | null;
  votes_up: number;
  votes_down: number;
  created_at: Date;
  updated_at: Date;
  post_count: string;
}
export interface PostRecord {
  id: string;
  thread_id: string;
  author_id: string;
  parent_post_id: string | null;
  kind: PostKind;
  content: string;
  status: string;
  votes_up: number;
  votes_down: number;
  created_at: Date;
  updated_at: Date;
}
export interface AttachmentRecord {
  id: string;
  post_id: string;
  kind: "photo" | "model_3mf";
  s3_key: string;
  size_bytes: number;
  created_at: Date;
}
export interface CreateCommunityInput {
  name: string;
  slug: string;
  description: string | null;
  visibility: string;
  tagIds: readonly string[];
  userId: UserId;
}
export interface CommunityListInput {
  kind?: string;
  q?: string;
  member?: string;
  cursor?: string;
  limit: number;
  userId: UserId;
}
export interface ThreadListInput {
  communityId: string;
  type?: ThreadType;
  cursor?: string;
  limit: number;
}
export interface CommunityView extends Omit<CommunityRecord, "member_count" | "thread_count"> {
  readonly is_official: boolean;
  readonly cover_image_url: string | null;
  readonly member_count: string | number;
  readonly thread_count: number;
  readonly viewer_role: CommunityRole | null;
}
export interface ThreadView extends Omit<ThreadRecord, "post_count"> {
  readonly post_count: number;
  readonly tags: readonly string[];
}
export interface AttachmentView {
  readonly id: string;
  readonly kind: "photo" | "model_3mf";
  readonly url: string;
  readonly size_bytes: number;
  readonly created_at: Date;
}
export interface PostView extends PostRecord {
  readonly is_accepted: boolean;
  readonly attachments: readonly AttachmentView[];
  readonly resolved_models: readonly ResolvedModel[];
}
export interface CommunityPage {
  readonly items: readonly CommunityView[];
  readonly next_cursor: string | null;
}
export interface ThreadPage {
  readonly items: readonly ThreadView[];
  readonly next_cursor: string | null;
}
export interface CommunityPort {
  create(input: CreateCommunityInput): Promise<CommunityView>;
  list(input: CommunityListInput): Promise<CommunityPage>;
  detail(id: string, userId: UserId): Promise<CommunityView & { readonly related_communities: readonly { id: string; slug: string; name: string; kind: string }[] }>;
  join(id: string, userId: UserId): Promise<{ readonly role: CommunityRole }>;
  leave(id: string, userId: UserId): Promise<{ readonly left: true }>;
  subscribe(id: string, userId: UserId, source: SubscribeSource | null): Promise<{ readonly role: CommunityRole }>;
  unsubscribe(id: string, userId: UserId, source: SubscribeSource | null): Promise<{ readonly left: true }>;
  setRole(id: string, target: UserId, actor: UserId, role: CommunityRole): Promise<{ readonly role: CommunityRole }>;
  bootstrapOwner(id: string, target: UserId, actor: UserId): Promise<{ readonly role: "owner"; readonly user_id: UserId }>;
  feed(id: string, sort: string, limit: number, cursor: string | null): Promise<CommunityFeedPage>;
  createThread(id: string, userId: UserId, input: { type: ThreadType; title: string; content: string; tags: string[] }): Promise<ThreadView>;
  threads(input: ThreadListInput): Promise<ThreadPage>;
  thread(id: string): Promise<{ readonly thread: ThreadView; readonly posts: readonly PostView[] }>;
  createPost(id: string, userId: UserId, input: { kind: PostKind; content: string; parentPostId?: string }): Promise<PostView>;
  voteThread(id: string, userId: UserId, value: 1 | -1 | 0): Promise<{ readonly votes_up: number; readonly votes_down: number; readonly my_vote: 1 | -1 | 0 }>;
  votePost(id: string, userId: UserId, value: 1 | -1 | 0): Promise<{ readonly votes_up: number; readonly votes_down: number; readonly my_vote: 1 | -1 | 0 }>;
  uploadAttachment(id: string, userId: UserId, file: { buffer: Buffer; originalname: string }): Promise<{ readonly attachment: AttachmentView }>;
  attachment(postId: string, id: string): Promise<{ kind: "photo" | "model_3mf"; key: string }>;
  accept(id: string, userId: UserId, postId: string | null): Promise<{ readonly accepted_post_id: string | null }>;
}
