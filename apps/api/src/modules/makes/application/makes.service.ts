import { Inject, Injectable, Logger, NotFoundException, Optional, PayloadTooLargeException, UnprocessableEntityException } from "@nestjs/common";
import type { Request } from "express";
import { MakeId, ModelId, type MakeId as MakeIdType, type ModelId as ModelIdType, type UserId } from "../../_kernel/brandedIds.ts";
import { ACHIEVEMENTS_PORT, type AchievementsPort } from "../../achievements/public/index.ts";
import { CATALOG_MAKES_PORT, type CatalogMakesPort } from "../../catalog/public/index.ts";
import { FEED_SOCIAL_OWNER_PORT, type FeedSocialOwnerPort } from "../../feed/public/index.ts";
import { MODEL_MAKES_PORT, type ModelMakesPort } from "../../models/public/index.ts";
import { REPORTS_PORT, type ReportsPort } from "../../moderation/public/index.ts";
import {
  ISSUE_TAGS,
  MAKE_CAPTION_MAX_LENGTH,
  MAKE_COMMENT_MAX_LENGTH,
  MAKE_NOTES_MAX_LENGTH,
  MAX_MAKE_PHOTO_BYTES,
  MAX_MAKE_PHOTOS,
  REASON_MAX_LENGTH,
  type MakeCommentRecord,
  type MakePhotoUploadOutcome,
  type MakeRecord,
  type MakeUpload,
} from "../domain/makes.ts";
import { MakesRepository } from "../infrastructure/makes.repository.ts";
import { PermissionsService } from "../../permissions/application/permissions.service.ts";
import { Permissions } from "../../permissions/domain/permissions.catalog.ts";
import {
  MAKE_COMMENTS_PORT,
  MAKE_FEED_SIGNAL_PORT,
  MAKE_PROFILE_PORT,
  MAKE_RATE_LIMIT_PORT,
  MAKE_STORAGE_PORT,
  MAKE_TAGS_PORT,
  MAKE_VOTES_PORT,
  type MakeCommentsPort,
  type MakeFeedSignalPort,
  type MakeProfilePort,
  type MakeRateLimitPort,
  type MakesPort,
  type MakeStoragePort,
  type MakeTagsPort,
  type MakeVotesPort,
  type MakeCommentsQuery,
  type MakeCreateFields,
  type MakeCreateResponse,
  type MakeDetail,
  type MakeLeaderboardItem,
  type MakePageResponse,
  type MakeSummary,
  type MakesListQuery,
} from "../public/index.ts";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DEFAULT_LIMIT = 24;
const MAX_LIMIT = 60;
const RELATED_LIMIT = 6;
const BEST_Z = 1.281551565545;

function invalid(): never {
  throw new UnprocessableEntityException();
}
function requiredUuid(value: unknown): string {
  if (typeof value !== "string" || !UUID_RE.test(value)) throw new NotFoundException();
  return value;
}
function optionalUuid(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || !UUID_RE.test(value)) invalid();
  return value;
}
function parseLimit(value: unknown, fallback = DEFAULT_LIMIT, max = MAX_LIMIT): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(Math.floor(parsed), max) : fallback;
}
function commaList(value: unknown): string[] {
  return typeof value === "string"
    ? value
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean)
    : [];
}
function rating(value: unknown): number | null {
  if (value === undefined || value === null || value === "") return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 5) invalid();
  return parsed;
}
function text(value: unknown, max: number): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || value.length > max) invalid();
  return value;
}
function decodeCursor(value: unknown, length: number): readonly (string | number)[] | null {
  if (typeof value !== "string" || value === "") return null;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    return Array.isArray(parsed) && parsed.length === length && parsed.every((item) => typeof item === "string" || typeof item === "number") ? parsed : null;
  } catch {
    return null;
  }
}
function encodeCursor(values: readonly (string | number)[]): string {
  return Buffer.from(JSON.stringify(values), "utf8").toString("base64url");
}
function feedTitle(caption: string | null, modelTitle: string | null): string {
  const base = caption?.trim() || (modelTitle === null ? "Новая работа" : `Напечатал(а) «${modelTitle}»`);
  return base.length > 300 ? `${base.slice(0, 297)}...` : base;
}
function score(row: MakeCommentRecord, sort: string): number {
  if (sort === "new") return Math.floor(row.created_at.getTime() / 1000);
  if (sort === "top") return row.votes_up - row.votes_down;
  const n = row.votes_up + row.votes_down;
  if (n <= 0) return 0;
  const phat = row.votes_up / n;
  const z2 = BEST_Z * BEST_Z;
  return (phat + z2 / (2 * n) - BEST_Z * Math.sqrt((phat * (1 - phat) + z2 / (4 * n)) / n)) / (1 + z2 / n);
}

@Injectable()
export class MakesService implements MakesPort {
  private readonly logger = new Logger(MakesService.name);

  constructor(
    @Inject(MakesRepository) private readonly repository: MakesRepository,
    @Inject(MODEL_MAKES_PORT) private readonly models: ModelMakesPort,
    @Inject(CATALOG_MAKES_PORT) private readonly catalog: CatalogMakesPort,
    @Inject(MAKE_PROFILE_PORT) private readonly profiles: MakeProfilePort,
    @Inject(MAKE_TAGS_PORT) private readonly tags: MakeTagsPort,
    @Inject(MAKE_VOTES_PORT) private readonly votes: MakeVotesPort,
    @Inject(MAKE_COMMENTS_PORT) private readonly commentOwner: MakeCommentsPort,
    @Inject(FEED_SOCIAL_OWNER_PORT) private readonly feed: FeedSocialOwnerPort,
    @Inject(MAKE_FEED_SIGNAL_PORT) private readonly feedSignals: MakeFeedSignalPort,
    @Inject(REPORTS_PORT) private readonly reports: ReportsPort,
    @Inject(ACHIEVEMENTS_PORT) private readonly achievements: AchievementsPort,
    @Inject(MAKE_STORAGE_PORT) private readonly storage: MakeStoragePort,
    @Inject(MAKE_RATE_LIMIT_PORT) private readonly rateLimits: MakeRateLimitPort,
    @Optional() private readonly permissions?: PermissionsService,
  ) {}

  async list(query: MakesListQuery): Promise<MakePageResponse> {
    const machineId = optionalUuid(query.machine_id);
    const materialId = optionalUuid(query.material_id);
    const modelId = optionalUuid(query.model_id);
    const sort = query.sort === "popular" ? "popular" : "new";
    const limit = parseLimit(query.limit);
    const tag = typeof query.tag === "string" && query.tag !== "" ? query.tag.toLowerCase() : null;
    const rows = await this.repository.list({
      machineId,
      materialId,
      modelId: modelId === null ? null : ModelId(modelId),
      taggedModelIds: tag === null ? null : await this.tags.modelIdsForTag(tag),
      sort,
      cursor: decodeCursor(query.cursor, sort === "popular" ? 3 : 2),
      limit,
    });
    return this.page(rows, limit, sort);
  }

  async followedFeed(authorIds: readonly UserId[], query: MakeCommentsQuery): Promise<MakePageResponse> {
    const limit = parseLimit(query.limit);
    const cursor = decodeCursor(query.cursor, 2);
    const rows = await this.repository.followedFeed(authorIds, cursor?.every((item) => typeof item === "string") === true ? cursor : null, limit);
    return this.page(rows, limit, "new");
  }

  async mine(userId: UserId, query: MakeCommentsQuery): Promise<MakePageResponse> {
    const limit = parseLimit(query.limit);
    const cursor = decodeCursor(query.cursor, 2);
    const rows = await this.repository.mine(userId, cursor?.every((item) => typeof item === "string") === true ? cursor : null, limit);
    return this.page(rows, limit, "new");
  }

  async detail(makeId: MakeIdType, userId: UserId): Promise<MakeDetail> {
    const record = await this.repository.find(makeId);
    if (record === null || (record.status !== "published" && record.user_id !== userId)) throw new NotFoundException();
    const materialIds = await this.repository.materialIds(makeId);
    const [summary, materials, photos, moreByModel, sameMaterial] = await Promise.all([
      this.hydrate([record]).then((items) => items[0]!),
      this.catalog.materials(materialIds),
      this.repository.photos(makeId, record.user_id === userId),
      record.model_id === null ? [] : this.repository.relatedByModel(record.model_id, makeId, RELATED_LIMIT),
      materialIds[0] === undefined ? [] : this.repository.relatedByMaterial(materialIds[0], makeId, RELATED_LIMIT),
    ]);
    return {
      ...summary,
      notes: record.notes,
      print_settings: record.print_settings,
      materials: materialIds
        .flatMap((id) => {
          const item = materials.get(id);
          return item === undefined ? [] : [item];
        })
        .sort((a, b) => a.name.localeCompare(b.name)),
      photos,
      more_prints_of_model: await this.hydrate(moreByModel),
      same_material_prints: await this.hydrate(sameMaterial),
    };
  }

  async create(userId: UserId, fields: MakeCreateFields, uploads: readonly MakeUpload[], request: Request): Promise<MakeCreateResponse> {
    await this.rateLimits.assertAllowed("make_create", userId, request);
    if (uploads.some((upload) => upload.buffer.byteLength > MAX_MAKE_PHOTO_BYTES)) throw new PayloadTooLargeException();
    const photos = uploads.slice(0, MAX_MAKE_PHOTOS);
    if (photos.length === 0) invalid();
    const modelIdRaw = optionalUuid(fields.model_id);
    const machineId = optionalUuid(fields.machine_id);
    if (machineId === null) invalid();
    const materialIds = commaList(fields.material_ids);
    if (materialIds.length === 0 || materialIds.some((id) => !UUID_RE.test(id))) invalid();
    const issueTags = commaList(fields.issue_tags);
    if (issueTags.some((tag) => !(ISSUE_TAGS as readonly string[]).includes(tag))) invalid();
    const printSettings = this.printSettings(fields.print_settings);
    const model = modelIdRaw === null ? null : await this.models.find(ModelId(modelIdRaw));
    if (modelIdRaw !== null && model === null) invalid();
    if ((await this.catalog.machine(machineId)) === null) invalid();
    const materials = await this.catalog.materials(materialIds);
    if (materials.size !== new Set(materialIds).size) invalid();
    const created = await this.repository.create({
      modelId: model?.id ?? null,
      userId,
      machineId,
      materialIds,
      caption: text(fields.caption, MAKE_CAPTION_MAX_LENGTH),
      printabilityRating: rating(fields.printability_rating),
      geometryQualityRating: rating(fields.geometry_quality_rating),
      surfaceQualityRating: rating(fields.surface_quality_rating),
      issueTags,
      notes: text(fields.notes, MAKE_NOTES_MAX_LENGTH),
      printSettings,
    });
    const outcomes: MakePhotoUploadOutcome[] = [];
    for (const upload of photos) {
      const result = await this.storage.uploadPhoto(created.id, upload);
      outcomes.push(
        result.ok
          ? {
              filename: upload.filename,
              status: "ok",
              id: result.photo.id,
              position: result.photo.position,
              is_cover: result.photo.is_cover,
              moderation_status: result.photo.moderation_status,
            }
          : { filename: upload.filename, status: "error", error: result.error },
      );
    }
    if (!outcomes.some((outcome) => outcome.status === "ok")) {
      await this.repository.delete(created.id);
      invalid();
    }
    try {
      await this.achievements.grantAchievement(userId, "first_make");
    } catch {
      this.logger.error("achievement grant failed");
    }
    await this.feed.createLinkedPost({
      kind: "make",
      authorId: userId,
      title: feedTitle(created.caption, model?.title ?? null),
      body: created.caption,
      modelId: created.model_id,
      makeId: created.id,
    });
    if (created.model_id !== null) {
      await this.models.incrementMakesCount(created.model_id);
      const postId = await this.feedSignals.findModelLinkPost(created.model_id);
      if (postId !== null) await this.feedSignals.recordRemix({ postId, makeId: created.id, modelId: created.model_id, userId, request });
    }
    const [summary] = await this.hydrate([created]);
    if (summary === undefined) throw new Error("Created make hydration returned no item");
    return { ...summary, photos: outcomes };
  }

  async repost(makeId: MakeIdType): Promise<{ readonly reposts_count: number }> {
    const count = await this.repository.increment(makeId, "reposts_count");
    if (count === null) throw new NotFoundException();
    return { reposts_count: count };
  }

  async view(makeId: MakeIdType): Promise<{ readonly views_count: number }> {
    const count = await this.repository.increment(makeId, "views_count");
    if (count === null) throw new NotFoundException();
    return { views_count: count };
  }

  async vote(makeId: MakeIdType, userId: UserId): Promise<{ readonly liked: boolean; readonly likes_count: number }> {
    if (!(await this.repository.publishedExists(makeId))) throw new NotFoundException();
    const result = await this.votes.toggleLike(makeId, userId);
    await this.repository.setLikesCount(makeId, result.likesCount);
    return { liked: result.liked, likes_count: result.likesCount };
  }

  async comments(makeId: MakeIdType, query: MakeCommentsQuery): Promise<{ readonly items: readonly MakeCommentRecord[]; readonly next_cursor: string | null }> {
    if (!(await this.repository.publishedExists(makeId))) throw new NotFoundException();
    const sort = query.sort === "new" || query.sort === "top" ? query.sort : "best";
    const limit = parseLimit(query.limit, 30, 100);
    const cursor = decodeCursor(query.cursor, 2);
    const scored = [...(await this.commentOwner.list(makeId))]
      .map((row) => ({ row, score: score(row, sort) }))
      .sort((left, right) => (right.score !== left.score ? right.score - left.score : left.row.id.localeCompare(right.row.id)));
    const cursorScore = cursor?.[0];
    const cursorId = cursor?.[1];
    const filtered =
      typeof cursorScore === "number" && typeof cursorId === "string"
        ? scored.filter((item) => item.score < cursorScore || (item.score === cursorScore && item.row.id > cursorId))
        : scored;
    const page = filtered.slice(0, limit);
    const last = page.at(-1);
    return { items: page.map(({ row }) => row), next_cursor: filtered.length > limit && last !== undefined ? encodeCursor([last.score, last.row.id]) : null };
  }

  async comment(makeId: MakeIdType, userId: UserId, rawBody: string | undefined, rawParentId: string | null | undefined): Promise<MakeCommentRecord> {
    if (typeof rawBody !== "string" || rawBody.trim() === "" || rawBody.length > MAKE_COMMENT_MAX_LENGTH) invalid();
    const parentId = rawParentId === undefined || rawParentId === null ? null : optionalUuid(rawParentId);
    if (rawParentId !== undefined && rawParentId !== null && parentId === null) invalid();
    if (!(await this.repository.publishedExists(makeId))) throw new NotFoundException();
    if (parentId !== null && !(await this.commentOwner.parentExists(makeId, parentId))) invalid();
    const created = await this.commentOwner.create({ makeId, userId, body: rawBody, parentId });
    await this.repository.incrementComments(makeId);
    return created;
  }

  async report(makeId: MakeIdType, userId: UserId, rawReason: unknown, request: Request) {
    await this.rateLimits.assertAllowed("make_report", userId, request);
    const reason = rawReason === undefined || rawReason === null ? null : text(rawReason, REASON_MAX_LENGTH)?.trim() || null;
    const record = await this.repository.find(makeId);
    if (record === null) throw new NotFoundException();
    if (record.user_id === userId) invalid();
    const { openCount } = await this.reports.enqueue("make", makeId, userId, reason);
    let status = record.status;
    const mayModerate = (await this.permissions?.hasPermission(userId, Permissions.MODERATION_DELETE_CONTENT)) === true;
    if (status !== "hidden" && (mayModerate || openCount >= this.reportHideThreshold())) {
      status = await this.repository.hide(makeId);
      await this.reports.resolveOpen("make", makeId);
    }
    return { make_id: makeId, make_status: status };
  }

  async leaderboard(modelId: ModelIdType, rawLimit: string | undefined): Promise<{ readonly items: readonly MakeLeaderboardItem[] }> {
    if ((await this.models.find(modelId)) === null) throw new NotFoundException();
    const rows = await this.repository.leaderboard(modelId, parseLimit(rawLimit, 10, 50));
    const authors = await this.profiles.authors(rows.map((row) => row.user_id));
    return {
      items: rows.map((row) => {
        const author = authors.get(row.user_id);
        return {
          id: row.id,
          user_id: row.user_id,
          username: author?.username ?? "",
          display_name: author?.display_name ?? null,
          avatar_url: author?.avatar_url ?? null,
          photo_s3_key: row.photo_s3_key,
          caption: row.caption,
          machine_id: row.machine_id,
          printability_rating: row.printability_rating,
          likes_count: row.likes_count,
          comments_count: row.comments_count,
          reposts_count: row.reposts_count,
          views_count: row.views_count,
          created_at: row.created_at,
          avatar_config: author?.avatar_config ?? null,
          avatar_snapshots: author?.avatar_snapshots ?? null,
        };
      }),
    };
  }

  async photo(makeId: MakeIdType, photoId: string, userId: UserId, request: Request) {
    await this.rateLimits.assertAllowed("make_image", userId, request);
    const found = await this.repository.photo(makeId, requiredUuid(photoId));
    if (found === null) throw new NotFoundException();
    const isAuthor = found.make.user_id === userId;
    if ((found.make.status !== "published" || found.moderationStatus !== "approved") && !isAuthor) throw new NotFoundException();
    return this.storage.asset(found.s3Key);
  }

  private async page(rows: readonly MakeRecord[], limit: number, sort: "new" | "popular"): Promise<MakePageResponse> {
    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    const last = items.at(-1);
    return {
      items: await this.hydrate(items),
      next_cursor:
        hasMore && last !== undefined
          ? encodeCursor(sort === "popular" ? [last.likes_count, last.created_at.toISOString(), last.id] : [last.created_at.toISOString(), last.id])
          : null,
    };
  }

  private async hydrate(rows: readonly MakeRecord[]): Promise<readonly MakeSummary[]> {
    if (rows.length === 0) return [];
    const materialEntries = await Promise.all(rows.map(async (row) => [row.id, await this.repository.materialIds(row.id)] as const));
    const modelIds = rows.flatMap((row) => (row.model_id === null ? [] : [row.model_id]));
    const machineIds = rows.flatMap((row) => (row.machine_id === null ? [] : [row.machine_id]));
    const [models, authors, machines] = await Promise.all([
      this.models.findMany(modelIds),
      this.profiles.authors(rows.map((row) => row.user_id)),
      Promise.all(machineIds.map(async (id) => [id, await this.catalog.machine(id)] as const)).then((entries) => new Map(entries)),
    ]);
    const materialIds = new Map(materialEntries);
    return rows.map((row) => {
      const author = authors.get(row.user_id);
      const model = row.model_id === null ? undefined : models.get(row.model_id);
      return {
        id: row.id,
        model_id: row.model_id,
        model_title: model?.title ?? null,
        author: {
          id: row.user_id,
          username: author?.username ?? "",
          display_name: author?.display_name ?? null,
          avatar_config: author?.avatar_config ?? null,
          avatar_snapshots: author?.avatar_snapshots ?? null,
        },
        machine_id: row.machine_id,
        machine_model: row.machine_id === null ? null : (machines.get(row.machine_id)?.model ?? null),
        material_ids: materialIds.get(row.id) ?? [],
        caption: row.caption,
        printability_rating: row.printability_rating,
        geometry_quality_rating: row.geometry_quality_rating,
        surface_quality_rating: row.surface_quality_rating,
        issue_tags: row.issue_tags,
        status: row.status,
        cover_photo_s3_key: row.cover_photo_s3_key,
        likes_count: row.likes_count,
        comments_count: row.comments_count,
        reposts_count: row.reposts_count,
        views_count: row.views_count,
        created_at: row.created_at,
      };
    });
  }

  private printSettings(value: unknown): Readonly<Record<string, unknown>> {
    if (value === undefined || value === null || value === "") return {};
    if (typeof value !== "string") invalid();
    try {
      const parsed: unknown = JSON.parse(value);
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) invalid();
      return parsed as Readonly<Record<string, unknown>>;
    } catch {
      return invalid();
    }
  }

  private reportHideThreshold(): number {
    const parsed = Number(process.env.MAKE_REPORT_HIDE_THRESHOLD);
    return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 3;
  }
}

export function makeId(value: string): MakeIdType {
  return MakeId(requiredUuid(value));
}
export function modelId(value: string): ModelIdType {
  return ModelId(requiredUuid(value));
}
