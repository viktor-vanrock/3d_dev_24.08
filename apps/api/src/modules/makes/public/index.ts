import type { Request } from "express";
import type { MakeId, ModelId, UserId } from "../../_kernel/brandedIds.ts";
import type { MakeAsset, MakeCommentRecord, MakePhotoUploadOutcome, MakeRecord, MakeStatus, MakeUpload } from "../domain/makes.ts";

export const MAKES_PORT = Symbol("MAKES_PORT");
export const MAKES_READ_PORT = Symbol("MAKES_READ_PORT");
export const MAKE_VOTES_PORT = Symbol("MAKE_VOTES_PORT");
export const MAKE_COMMENTS_PORT = Symbol("MAKE_COMMENTS_PORT");
export const MAKE_TAGS_PORT = Symbol("MAKE_TAGS_PORT");
export const MAKE_PROFILE_PORT = Symbol("MAKE_PROFILE_PORT");
export const MAKE_STORAGE_PORT = Symbol("MAKE_STORAGE_PORT");
export const MAKE_RATE_LIMIT_PORT = Symbol("MAKE_RATE_LIMIT_PORT");
export const MAKE_FEED_SIGNAL_PORT = Symbol("MAKE_FEED_SIGNAL_PORT");
export { meshBaseUrl } from "../infrastructure/mesh-client.ts";
export { getMachineMakeStats, getMaterialMakeStats, getModelMakeStats, listMakesByMachine, listMakesByMaterial, topCombosForModel } from "../infrastructure/make-stats.ts";

export interface MakesReadPort {
  isOwned(makeId: string, userId: UserId): Promise<boolean>;
}

export interface MakeVotesPort {
  toggleLike(makeId: MakeId, userId: UserId): Promise<{ readonly liked: boolean; readonly likesCount: number }>;
}

export interface MakeCommentsPort {
  list(makeId: MakeId): Promise<readonly MakeCommentRecord[]>;
  parentExists(makeId: MakeId, parentId: string): Promise<boolean>;
  create(input: { readonly makeId: MakeId; readonly userId: UserId; readonly body: string; readonly parentId: string | null }): Promise<MakeCommentRecord>;
}

export interface MakeTagsPort {
  modelIdsForTag(name: string): Promise<readonly ModelId[]>;
}

export interface MakeAuthor {
  readonly id: UserId;
  readonly username: string;
  readonly display_name: string | null;
  readonly avatar_url: string | null;
  readonly avatar_config: MakeAvatarConfig | null;
  readonly avatar_snapshots: MakeAvatarSnapshots | null;
}

export interface MakeAvatarConfig {
  readonly color: string;
  readonly texture: string;
  readonly pose: string;
  readonly outfit: string;
  readonly hat: string;
  readonly eyes: string;
  readonly beard: string;
  readonly arms: string;
  readonly accessory: string;
  readonly back: string;
}
export interface MakeAvatarSnapshots {
  readonly left: string | null;
  readonly right: string | null;
  readonly front: string | null;
}
export interface MakeSummary {
  readonly id: MakeId;
  readonly model_id: ModelId | null;
  readonly model_title: string | null;
  readonly author: {
    readonly id: UserId;
    readonly username: string;
    readonly display_name: string | null;
    readonly avatar_config: MakeAvatarConfig | null;
    readonly avatar_snapshots: MakeAvatarSnapshots | null;
  };
  readonly machine_id: string | null;
  readonly machine_model: string | null;
  readonly material_ids: readonly string[];
  readonly caption: string | null;
  readonly printability_rating: number | null;
  readonly geometry_quality_rating: number | null;
  readonly surface_quality_rating: number | null;
  readonly issue_tags: readonly string[];
  readonly status: MakeStatus;
  readonly cover_photo_s3_key: string | null;
  readonly likes_count: number;
  readonly comments_count: number;
  readonly reposts_count: number;
  readonly views_count: number;
  readonly created_at: Date;
}
export interface MakePageResponse {
  readonly items: readonly MakeSummary[];
  readonly next_cursor: string | null;
}
export interface MakeCreateFields {
  readonly model_id?: string;
  readonly machine_id?: string;
  readonly material_ids?: string;
  readonly caption?: string;
  readonly printability_rating?: string;
  readonly geometry_quality_rating?: string;
  readonly surface_quality_rating?: string;
  readonly issue_tags?: string;
  readonly notes?: string;
  readonly print_settings?: string;
}
export interface MakeCommentsQuery {
  readonly sort?: string;
  readonly cursor?: string;
  readonly limit?: string;
}
export interface MakeDetail extends MakeSummary {
  readonly notes: string | null;
  readonly print_settings: MakePrintSettings;
  readonly materials: readonly CatalogMakeMaterialResponse[];
  readonly photos: readonly MakePhotoResponse[];
  readonly more_prints_of_model: readonly MakeSummary[];
  readonly same_material_prints: readonly MakeSummary[];
}
export interface MakePrintSettings {
  readonly layer_height_mm?: number;
  readonly nozzle_temp_c?: number;
  readonly bed_temp_c?: number;
  readonly infill_percent?: number;
  readonly supports?: boolean;
  readonly filament?: string;
  readonly printer?: string;
}
export interface CatalogMakeMaterialResponse {
  readonly id: string;
  readonly name: string;
}
export interface MakePhotoResponse {
  readonly id: string;
  readonly position: number;
  readonly is_cover: boolean;
  readonly moderation_status: string;
}
export interface MakeCreateResponse extends MakeSummary {
  readonly photos: readonly MakePhotoUploadOutcome[];
}
export interface MakeLeaderboardItem {
  readonly id: MakeId;
  readonly user_id: UserId;
  readonly username: string;
  readonly display_name: string | null;
  readonly avatar_url: string | null;
  readonly photo_s3_key: string | null;
  readonly caption: string | null;
  readonly machine_id: string | null;
  readonly printability_rating: number | null;
  readonly likes_count: number;
  readonly comments_count: number;
  readonly reposts_count: number;
  readonly views_count: number;
  readonly created_at: Date;
  readonly avatar_config: MakeAvatarConfig | null;
  readonly avatar_snapshots: MakeAvatarSnapshots | null;
}

export interface MakeProfilePort {
  authors(userIds: readonly UserId[]): Promise<ReadonlyMap<UserId, MakeAuthor>>;
}

export interface MakeStoragePort {
  uploadPhoto(
    makeId: MakeId,
    upload: MakeUpload,
  ): Promise<
    | { readonly ok: true; readonly photo: { readonly id: string; readonly position: number; readonly is_cover: boolean; readonly moderation_status: string } }
    | { readonly ok: false; readonly error: string }
  >;
  asset(key: string): Promise<MakeAsset>;
}

export interface MakeRateLimitPort {
  assertAllowed(action: "make_create" | "make_image" | "make_report", userId: UserId, request: Request): Promise<void>;
}

export interface MakeFeedSignalPort {
  findModelLinkPost(modelId: ModelId): Promise<string | null>;
  recordRemix(input: { readonly postId: string; readonly makeId: MakeId; readonly modelId: ModelId; readonly userId: UserId; readonly request: Request }): Promise<void>;
}

export interface MakesPort {
  list(query: MakesListQuery): Promise<MakePageResponse>;
  followedFeed(authorIds: readonly UserId[], query: MakeCommentsQuery): Promise<MakePageResponse>;
  mine(userId: UserId, query: MakeCommentsQuery): Promise<MakePageResponse>;
  detail(makeId: MakeId, userId: UserId): Promise<MakeDetail>;
  create(userId: UserId, fields: MakeCreateFields, uploads: readonly MakeUpload[], request: Request): Promise<MakeCreateResponse>;
  repost(makeId: MakeId): Promise<{ readonly reposts_count: number }>;
  view(makeId: MakeId): Promise<{ readonly views_count: number }>;
  vote(makeId: MakeId, userId: UserId): Promise<{ readonly liked: boolean; readonly likes_count: number }>;
  comments(makeId: MakeId, query: MakeCommentsQuery): Promise<{ readonly items: readonly MakeCommentRecord[]; readonly next_cursor: string | null }>;
  comment(makeId: MakeId, userId: UserId, body: string | undefined, parentId: string | null | undefined): Promise<MakeCommentRecord>;
  report(makeId: MakeId, userId: UserId, reason: string | null | undefined, request: Request): Promise<{ readonly make_id: MakeId; readonly make_status: MakeStatus }>;
  leaderboard(modelId: ModelId, limit: string | undefined): Promise<{ readonly items: readonly MakeLeaderboardItem[] }>;
  photo(makeId: MakeId, photoId: string, userId: UserId, request: Request): Promise<MakeAsset>;
}

export interface MakesListQuery extends MakeCommentsQuery {
  readonly machine_id?: string;
  readonly material_id?: string;
  readonly tag?: string;
  readonly model_id?: string;
}

export type { MakeAsset, MakeCommentRecord, MakeRecord, MakeUpload };
export { REASON_MAX_LENGTH } from "../domain/report.ts";
export { uploadMakePhoto } from "../infrastructure/mesh-client.ts";
