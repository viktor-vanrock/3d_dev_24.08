import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pool } from "../../../db/client.ts";
import { UserId } from "../../_kernel/brandedIds.ts";
import { ProfileRepository } from "../infrastructure/profile.repository.ts";
import { ProfileStorageAdapter } from "../infrastructure/profile-storage.adapter.ts";
import type { ProfileAggregatesPort } from "../public/index.ts";
import { ProfileService } from "./profile.service.ts";

const createdIds: string[] = [];
let repository: ProfileRepository;
let service: ProfileService;

class MemoryProfileStorage extends ProfileStorageAdapter {
  readonly objects = new Map<string, Buffer>();

  override configured(): boolean {
    return true;
  }

  override put(key: string, body: Buffer): Promise<void> {
    this.objects.set(key, body);
    return Promise.resolve();
  }

  override delete(key: string): Promise<void> {
    this.objects.delete(key);
    return Promise.resolve();
  }

  override publicUrl(): string | null {
    return null;
  }

  override object(key: string) {
    const body = this.objects.get(key);
    return Promise.resolve(body === undefined ? null : { body: Readable.from(body), contentLength: body.length });
  }
}

const storage = new MemoryProfileStorage();

const aggregates: ProfileAggregatesPort = {
  forUser() {
    return Promise.resolve({
      modelsCount: 1,
      projectViewsCount: 2,
      projectDownloadsCount: 3,
      postsCount: 4,
      postViewsCount: 5,
      postScore: 6,
      postCommentsCount: 7,
      printersCount: 3,
      followersCount: 11,
      followingCount: 8,
      isFollowing: true,
    });
  },
};

describe("Profile core application and repository", () => {
  beforeAll(() => {
    repository = new ProfileRepository(pool);
    service = new ProfileService(repository, storage, aggregates);
  });

  afterAll(async () => {
    if (createdIds.length > 0) await pool.query(`delete from users where id = any($1::uuid[])`, [createdIds]);
  });

  it("exposes the exact auth owner port contract and allocates collision-safe handles", async () => {
    const handle = `nest.profile.${randomUUID().slice(0, 8)}`;
    const first = await repository.createUserWithFreeHandle({ handle, displayName: "First", avatarUrl: null });
    const second = await repository.createUserWithFreeHandle({ handle, displayName: "Second", avatarUrl: null });
    createdIds.push(first, second);

    expect(second).not.toBe(first);
    await expect(repository.findSessionUser(first)).resolves.toMatchObject({
      id: first,
      username: handle,
      displayName: "First",
      avatarUrl: null,
      handleConfirmed: false,
      role: "user",
    });
    await expect(repository.findSessionUser(second)).resolves.toMatchObject({ username: `${handle}2` });
  });

  it("preserves PATCH /me normalization and materializes a stable mascot", async () => {
    const inserted = await pool.query<{ id: string }>(`insert into users (username) values ($1) returning id`, [`nest-profile-${randomUUID()}`]);
    const id = UserId(inserted.rows[0]!.id);
    createdIds.push(id);

    const patched = await service.patchProfile(id, {
      username: `changed.${randomUUID().slice(0, 8).toLowerCase()}`,
      display_name: "  Maker  ",
      bio: "  Bio  ",
      website_url: "https://example.test/profile",
      contacts: [{ label: " Site ", url: " https://example.test " }],
    });
    expect(patched.user).toMatchObject({
      display_name: "Maker",
      bio: "Bio",
      website_url: "https://example.test/profile",
      contacts: [{ label: "Site", url: "https://example.test" }],
      handle_confirmed: true,
    });

    const first = await service.avatar(id);
    const second = await service.avatar(id);
    expect(first.revision).toBe(1);
    expect(second.config).toEqual(first.config);
    expect(first.snapshots).toEqual({ left: null, right: null, front: null });
  });

  it("combines owner-only user data with a cross-domain aggregate port", async () => {
    const username = `nest-public-profile-${randomUUID()}`;
    const inserted = await pool.query<{ id: string }>(
      `insert into users (username, reputation_score, trust_level, maker_verified)
       values ($1, 42, 2, true) returning id`,
      [username],
    );
    const id = UserId(inserted.rows[0]!.id);
    createdIds.push(id);

    const response = await service.profile(username, null);
    expect(response.user).toMatchObject({
      id,
      reputation_score: 42,
      trust_level: 2,
      models_count: 1,
      project_views_count: 2,
      project_downloads_count: 3,
      posts_count: 4,
      post_views_count: 5,
      post_score: 6,
      post_comments_count: 7,
      followers_count: 11,
      following_count: 8,
      is_following: true,
      badges: ["verified", "top_farm", "popular"],
    });
  });

  it("stores photo and immutable mascot snapshot bytes through the private S3 adapter seam", async () => {
    const inserted = await pool.query<{ id: string }>(`insert into users (username) values ($1) returning id`, [`nest-profile-media-${randomUUID()}`]);
    const id = UserId(inserted.rows[0]!.id);
    createdIds.push(id);
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");

    const photo = await service.uploadAvatarPhoto(id, { buffer: png });
    expect(photo.user.avatar_url).toBe(`/avatars/${id}`);
    const photoAsset = await service.avatarAsset(id);
    expect(photoAsset.object?.contentLength).toBe(png.length);

    const current = await service.avatar(id);
    const patched = await service.patchAvatar(id, {
      config: current.config,
      snapshots: { left: png.toString("base64") },
    });
    expect(patched.revision).toBe(2);
    expect(patched.snapshots.left).toMatch(new RegExp(`^/avatars/${id}/snapshots/2/left/[0-9a-f]{64}\\.png$`));
    const hash = patched.snapshots
      .left!.split("/")
      .at(-1)!
      .replace(/\.png$/, "");
    const snapshot = await service.snapshotAsset(id, 2, "left", hash);
    expect(snapshot.object?.contentLength).toBe(png.length);
  });
});
