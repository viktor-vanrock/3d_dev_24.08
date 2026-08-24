import type { Readable } from "node:stream";
import type { MakeId, ModelId, UserId } from "../../_kernel/brandedIds.ts";

export const ISSUE_TAGS = ["warping", "stringing", "layer_shift", "adhesion"] as const;
export const MAKE_STATUSES = ["draft", "pending", "published", "hidden"] as const;
export const MAKE_CAPTION_MAX_LENGTH = 2000;
export const MAKE_NOTES_MAX_LENGTH = 2000;
export const MAKE_COMMENT_MAX_LENGTH = 4000;
export const REASON_MAX_LENGTH = 500;
export const MAX_MAKE_PHOTO_BYTES = 12 * 1024 * 1024;
export const MAX_MAKE_PHOTOS = 6;

export type MakeStatus = (typeof MAKE_STATUSES)[number];

export interface MakeRecord {
  readonly id: MakeId;
  readonly model_id: ModelId | null;
  readonly user_id: UserId;
  readonly machine_id: string | null;
  readonly caption: string | null;
  readonly printability_rating: number | null;
  readonly geometry_quality_rating: number | null;
  readonly surface_quality_rating: number | null;
  readonly issue_tags: readonly string[];
  readonly notes: string | null;
  readonly print_settings: Readonly<Record<string, unknown>>;
  readonly status: MakeStatus;
  readonly likes_count: number;
  readonly comments_count: number;
  readonly reposts_count: number;
  readonly views_count: number;
  readonly cover_photo_s3_key: string | null;
  readonly photo_s3_key: string | null;
  readonly created_at: Date;
}

export interface MakePhotoRecord {
  readonly id: string;
  readonly position: number;
  readonly is_cover: boolean;
  readonly moderation_status: string;
}

export interface MakeCommentRecord {
  readonly id: string;
  readonly user_id: UserId;
  readonly parent_id: string | null;
  readonly body: string;
  readonly votes_up: number;
  readonly votes_down: number;
  readonly created_at: Date;
}

export interface MakeAsset {
  readonly publicUrl: string | null;
  readonly object: { readonly body: Readable; readonly etag?: string; readonly contentLength?: number } | null;
  readonly contentType: string;
}

export interface MakeUpload {
  readonly buffer: Buffer;
  readonly filename: string;
  readonly contentType: string;
}

export interface MakePhotoUploadOutcome {
  readonly filename: string;
  readonly status: "ok" | "error";
  readonly id?: string;
  readonly position?: number;
  readonly is_cover?: boolean;
  readonly moderation_status?: string;
  readonly error?: string;
}
