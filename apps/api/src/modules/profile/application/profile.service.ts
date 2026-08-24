import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  ServiceUnavailableException,
  UnsupportedMediaTypeException,
} from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";
import { UserId, type UserId as UserIdType } from "../../_kernel/brandedIds.ts";
import {
  AVATAR_SNAPSHOT_SIDES,
  AVATAR_URL_MAX,
  BIO_MAX,
  DISPLAY_NAME_MAX,
  IMAGE_FORMATS,
  WEBSITE_URL_MAX,
  avatarPhotoUrl,
  configsEqual,
  detectImageFormat,
  isValidUsername,
  parseAvatarConfig,
  sanitizeContacts,
  type AvatarConfig,
  type AvatarSnapshotSide,
  type AvatarSnapshots,
  type ProfileContact,
} from "../domain/profile.ts";
import { ProfileRepository, type AvatarRow, type UpdatedUser, type UserUpdate } from "../infrastructure/profile.repository.ts";
import { ProfileStorageAdapter } from "../infrastructure/profile-storage.adapter.ts";
import { PROFILE_AGGREGATES_PORT, type ProfileAggregatesPort } from "../public/index.ts";

export const MAX_AVATAR_PHOTO_BYTES = 5 * 1024 * 1024;
export const MAX_SNAPSHOT_BYTES = 2 * 1024 * 1024;

export interface ProfilePatchInput {
  readonly username?: string | null;
  readonly display_name?: string | null;
  readonly avatar_url?: string | null;
  readonly bio?: string | null;
  readonly website_url?: string | null;
  readonly contacts?: readonly ProfileContact[];
}

export interface AvatarPatchInput {
  readonly config?: AvatarConfig;
  readonly snapshots?: Partial<Record<AvatarSnapshotSide, string>>;
}

export interface ProfilePageResponse {
  readonly user: {
    readonly id: string;
    readonly username: string;
    readonly display_name: string | null;
    readonly avatar_url: string | null;
    readonly avatar_config: AvatarConfig | null;
    readonly avatar_snapshots: AvatarSnapshots | null;
    readonly bio: string | null;
    readonly website_url: string | null;
    readonly contacts: readonly ProfileContact[];
    readonly models_count: number;
    readonly project_views_count: number;
    readonly project_downloads_count: number;
    readonly posts_count: number;
    readonly post_views_count: number;
    readonly post_score: number;
    readonly post_comments_count: number;
    readonly followers_count: number;
    readonly following_count: number;
    readonly is_following: boolean;
    readonly badges: readonly string[];
    readonly reputation_score: number;
    readonly trust_level: number;
  };
}

function badges(makerVerified: boolean, printersCount: number, followersCount: number): string[] {
  const result: string[] = [];
  if (makerVerified) result.push("verified");
  if (printersCount >= 3) result.push("top_farm");
  if (followersCount > 10) result.push("popular");
  return result;
}

function isPgUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "23505";
}

@Injectable()
export class ProfileService {
  constructor(
    @Inject(ProfileRepository) private readonly repository: ProfileRepository,
    @Inject(ProfileStorageAdapter) private readonly storage: ProfileStorageAdapter,
    @Inject(PROFILE_AGGREGATES_PORT) private readonly aggregates: ProfileAggregatesPort,
  ) {}

  async profile(username: string, viewerId: UserIdType | null): Promise<ProfilePageResponse> {
    const row = await this.repository.findProfilePage(username);
    if (row === null) throw new NotFoundException();
    const avatar = await this.repository.materializeAvatar(UserId(row.id));
    const aggregate = await this.aggregates.forUser(UserId(row.id), viewerId);
    return {
      user: {
        id: row.id,
        username: row.username,
        display_name: row.display_name,
        avatar_url: row.avatar_url,
        avatar_config: avatar?.config ?? null,
        avatar_snapshots: avatar === null ? null : this.repository.snapshots(row.id, avatar),
        bio: row.bio,
        website_url: row.website_url,
        contacts: row.contacts,
        models_count: aggregate.modelsCount,
        project_views_count: aggregate.projectViewsCount,
        project_downloads_count: aggregate.projectDownloadsCount,
        posts_count: aggregate.postsCount,
        post_views_count: aggregate.postViewsCount,
        post_score: aggregate.postScore,
        post_comments_count: aggregate.postCommentsCount,
        followers_count: aggregate.followersCount,
        following_count: aggregate.followingCount,
        is_following: aggregate.isFollowing,
        badges: badges(row.maker_verified, aggregate.printersCount, aggregate.followersCount),
        reputation_score: row.reputation_score,
        trust_level: row.trust_level,
      },
    };
  }

  async patchProfile(userId: UserIdType, input: ProfilePatchInput): Promise<{ user: UpdatedUser }> {
    const update: UserUpdate = {};
    if (input.username !== undefined) {
      if (typeof input.username !== "string") throw new BadRequestException();
      const username = input.username.trim().toLowerCase();
      if (!isValidUsername(username)) throw new BadRequestException();
      Object.assign(update, { username, handleConfirmed: true });
    }
    if (input.display_name !== undefined) {
      if (input.display_name !== null && typeof input.display_name !== "string") throw new BadRequestException();
      Object.assign(update, {
        displayName: typeof input.display_name === "string" ? input.display_name.trim().slice(0, DISPLAY_NAME_MAX) || null : null,
      });
    }
    if (input.avatar_url !== undefined) {
      if (input.avatar_url !== null && typeof input.avatar_url !== "string") throw new BadRequestException();
      Object.assign(update, {
        avatarUrl: typeof input.avatar_url === "string" ? input.avatar_url.trim().slice(0, AVATAR_URL_MAX) || null : null,
        clearAvatarKey: true,
      });
    }
    if (input.bio !== undefined) {
      if (input.bio !== null && typeof input.bio !== "string") throw new BadRequestException();
      Object.assign(update, { bio: typeof input.bio === "string" ? input.bio.trim().slice(0, BIO_MAX) || null : null });
    }
    if (input.website_url !== undefined) {
      if (input.website_url !== null && typeof input.website_url !== "string") throw new BadRequestException();
      const websiteUrl = typeof input.website_url === "string" ? input.website_url.trim().slice(0, WEBSITE_URL_MAX) || null : null;
      if (websiteUrl !== null && !/^https?:\/\//i.test(websiteUrl)) throw new BadRequestException();
      Object.assign(update, { websiteUrl });
    }
    if (input.contacts !== undefined) {
      const contacts = sanitizeContacts(input.contacts);
      if (contacts === null) throw new BadRequestException();
      Object.assign(update, { contacts });
    }
    if (Object.keys(update).length === 0) throw new BadRequestException();
    try {
      const user = await this.repository.updateUser(userId, update);
      if (user === null) throw new NotFoundException();
      return { user };
    } catch (error) {
      if (isPgUniqueViolation(error)) throw new ConflictException();
      throw error;
    }
  }

  async avatar(userId: UserIdType): Promise<{ config: AvatarConfig; revision: number; snapshots: AvatarSnapshots }> {
    const row = await this.repository.materializeAvatar(userId);
    if (row === null) throw new NotFoundException();
    return this.avatarResponse(userId, row);
  }

  async patchAvatar(userId: UserIdType, input: AvatarPatchInput): Promise<{ config: AvatarConfig; revision: number; snapshots: AvatarSnapshots }> {
    const config = parseAvatarConfig(input.config);
    if (config === null) throw new BadRequestException();
    const current = await this.repository.materializeAvatar(userId);
    if (current === null) throw new NotFoundException();
    const currentRevision = Number(current.revision);
    const uploaded: Partial<Record<AvatarSnapshotSide, string>> = {};
    const hashes: Partial<Record<AvatarSnapshotSide, string>> = {};
    const buffers = this.parseSnapshotBuffers(input.snapshots);
    if (Object.keys(buffers).length > 0 && !this.storage.configured()) throw new ServiceUnavailableException();
    try {
      for (const side of AVATAR_SNAPSHOT_SIDES) {
        const buffer = buffers[side];
        if (buffer === undefined) continue;
        const sha256 = createHash("sha256").update(buffer).digest("hex");
        const key = this.storage.snapshotKey(userId, currentRevision + 1, side, sha256, randomUUID());
        await this.storage.put(key, buffer, "image/png", "public, max-age=31536000, immutable");
        uploaded[side] = key;
        hashes[side] = sha256;
      }
    } catch {
      await this.deleteAll(Object.values(uploaded));
      throw new InternalServerErrorException();
    }
    const preserveExisting = configsEqual(current.config, config);
    const keys = this.mergeSnapshots(current, uploaded, preserveExisting, "s3_key");
    const nextHashes = this.mergeSnapshots(current, hashes, preserveExisting, "sha256");
    let row: AvatarRow | null;
    try {
      row = await this.repository.updateAvatarCas(userId, currentRevision, config, keys, nextHashes);
    } catch (error) {
      await this.deleteAll(Object.values(uploaded));
      throw error;
    }
    if (row === null) {
      await this.deleteAll(Object.values(uploaded));
      throw new ConflictException();
    }
    const retained = new Set(AVATAR_SNAPSHOT_SIDES.map((side) => row[`snapshot_${side}_s3_key`]).filter((key): key is string => key !== null));
    for (const side of AVATAR_SNAPSHOT_SIDES) {
      const previous = current[`snapshot_${side}_s3_key`];
      if (previous !== null && !retained.has(previous)) void this.storage.delete(previous).catch(() => undefined);
    }
    return this.avatarResponse(userId, row);
  }

  async uploadAvatarPhoto(userId: UserIdType, file: { readonly buffer: Buffer } | undefined): Promise<{ user: UpdatedUser }> {
    if (!this.storage.configured()) throw new ServiceUnavailableException();
    if (file === undefined) throw new BadRequestException();
    if (file.buffer.length > MAX_AVATAR_PHOTO_BYTES) throw new HttpException("", HttpStatus.PAYLOAD_TOO_LARGE);
    const format = detectImageFormat(file.buffer);
    if (format === null) throw new UnsupportedMediaTypeException();
    const { ext, contentType } = IMAGE_FORMATS[format];
    const key = this.storage.avatarKey(userId, randomUUID(), ext);
    try {
      await this.storage.put(key, file.buffer, contentType);
    } catch {
      throw new InternalServerErrorException();
    }
    const { user, previousKey } = await this.repository.replaceAvatarPhoto(userId, avatarPhotoUrl(userId), key);
    if (user === null) {
      await this.storage.delete(key).catch(() => undefined);
      throw new NotFoundException();
    }
    if (previousKey !== null) void this.storage.delete(previousKey).catch(() => undefined);
    return { user };
  }

  async avatarAsset(userId: UserIdType): Promise<{ key: string; publicUrl: string | null; object: Awaited<ReturnType<ProfileStorageAdapter["object"]>> }> {
    const key = await this.repository.activeAvatarKey(userId);
    if (key === null) throw new NotFoundException();
    const publicUrl = this.storage.publicUrl(key);
    if (publicUrl !== null) return { key, publicUrl, object: null };
    const object = await this.storage.object(key);
    if (object === null) throw new NotFoundException();
    return { key, publicUrl: null, object };
  }

  async currentSnapshot(userId: UserIdType, side: AvatarSnapshotSide): Promise<string> {
    const snapshot = await this.repository.currentSnapshot(userId, side);
    if (snapshot === null) throw new NotFoundException();
    return `/avatars/${userId}/snapshots/${snapshot.revision}/${side}/${snapshot.sha256}.png`;
  }

  async snapshotAsset(userId: UserIdType, revision: number, side: AvatarSnapshotSide, sha256: string) {
    const key = await this.repository.snapshotKey(userId, revision, side, sha256);
    if (key === null) throw new NotFoundException();
    const publicUrl = this.storage.publicUrl(key);
    if (publicUrl !== null) return { publicUrl, object: null };
    const object = await this.storage.object(key);
    if (object === null) throw new NotFoundException();
    return { publicUrl: null, object };
  }

  private avatarResponse(userId: UserIdType, row: AvatarRow) {
    return { config: row.config, revision: Number(row.revision), snapshots: this.repository.snapshots(userId, row) };
  }

  private parseSnapshotBuffers(value: unknown): Partial<Record<AvatarSnapshotSide, Buffer>> {
    if (value === undefined) return {};
    if (typeof value !== "object" || value === null || Array.isArray(value)) throw new BadRequestException();
    const input = value as Partial<Record<AvatarSnapshotSide, unknown>>;
    const result: Partial<Record<AvatarSnapshotSide, Buffer>> = {};
    for (const side of AVATAR_SNAPSHOT_SIDES) {
      const raw = input[side];
      if (raw === undefined) continue;
      if (typeof raw !== "string" || raw === "") throw new BadRequestException();
      const prefix = "data:image/png;base64,";
      if (raw.includes(",") && !raw.startsWith(prefix)) throw new BadRequestException();
      const base64 = raw.startsWith(prefix) ? raw.slice(prefix.length) : raw;
      if (!/^[A-Za-z0-9+/]+={0,2}$/.test(base64) || base64.length % 4 !== 0) throw new BadRequestException();
      const buffer = Buffer.from(base64, "base64");
      if (buffer.length === 0) throw new BadRequestException();
      if (buffer.length > MAX_SNAPSHOT_BYTES) throw new HttpException("", HttpStatus.PAYLOAD_TOO_LARGE);
      if (detectImageFormat(buffer) !== "png") throw new UnsupportedMediaTypeException();
      result[side] = buffer;
    }
    return result;
  }

  private mergeSnapshots(current: AvatarRow, incoming: Partial<Record<AvatarSnapshotSide, string>>, preserveExisting: boolean, suffix: "s3_key" | "sha256"): AvatarSnapshots {
    const value = (side: AvatarSnapshotSide): string | null => incoming[side] ?? (preserveExisting ? current[`snapshot_${side}_${suffix}`] : null);
    return { left: value("left"), right: value("right"), front: value("front") };
  }

  private async deleteAll(keys: readonly string[]): Promise<void> {
    await Promise.allSettled(keys.map((key) => this.storage.delete(key)));
  }
}
