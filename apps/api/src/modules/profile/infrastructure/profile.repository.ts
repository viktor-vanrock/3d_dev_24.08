import { Inject, Injectable } from "@nestjs/common";
import { randomBytes } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { DATABASE_POOL } from "../../../nest/database/database.constants.ts";
import { UserId, type UserId as UserIdType } from "../../_kernel/brandedIds.ts";
import {
  avatarSnapshotUrl,
  deterministicAvatarConfig,
  normalizeAvatarConfig,
  type AvatarConfig,
  type AvatarSnapshotSide,
  type AvatarSnapshots,
  type ProfileContact,
} from "../domain/profile.ts";
import type {
  NewUserSeed,
  ProfileAdminPort,
  ProfileAuthPort,
  ProfileContentPort,
  ProfileMasterPort,
  ProfileMasterState,
  ProfileReadPort,
  ProfileSanctionsPort,
  PublicContentAuthor,
  PublicMasterProfile,
  PublicProfile,
  SessionProfile,
} from "../public/index.ts";

interface ProfileRow {
  id: string;
  username: string;
  display_name: string | null;
}

interface SessionProfileRow extends ProfileRow {
  avatar_url: string | null;
  handle_confirmed: boolean;
  role: "user" | "researcher";
}

export interface ProfilePageRow extends SessionProfileRow {
  bio: string | null;
  website_url: string | null;
  contacts: ProfileContact[];
  reputation_score: number;
  trust_level: number;
  maker_verified: boolean;
}

export interface UserUpdate {
  readonly username?: string;
  readonly handleConfirmed?: boolean;
  readonly displayName?: string | null;
  readonly avatarUrl?: string | null;
  readonly clearAvatarKey?: boolean;
  readonly bio?: string | null;
  readonly websiteUrl?: string | null;
  readonly contacts?: readonly ProfileContact[];
}

export interface UpdatedUser {
  readonly id: string;
  readonly username: string;
  readonly display_name: string | null;
  readonly avatar_url: string | null;
  readonly bio: string | null;
  readonly website_url: string | null;
  readonly contacts: ProfileContact[];
  readonly handle_confirmed: boolean;
}

export interface AvatarRow {
  readonly config: AvatarConfig;
  readonly revision: string | number;
  readonly snapshot_left_s3_key: string | null;
  readonly snapshot_right_s3_key: string | null;
  readonly snapshot_front_s3_key: string | null;
  readonly snapshot_left_sha256: string | null;
  readonly snapshot_right_sha256: string | null;
  readonly snapshot_front_sha256: string | null;
}

function mapProfile(row: ProfileRow): PublicProfile {
  return { id: UserId(row.id), username: row.username, displayName: row.display_name };
}

function mapSession(row: SessionProfileRow): SessionProfile {
  return {
    id: UserId(row.id),
    username: row.username,
    displayName: row.display_name,
    avatarUrl: row.avatar_url,
    handleConfirmed: row.handle_confirmed,
    role: row.role,
  };
}

const AVATAR_SELECT = `
  config, revision,
  snapshot_left_s3_key, snapshot_right_s3_key, snapshot_front_s3_key,
  snapshot_left_sha256, snapshot_right_sha256, snapshot_front_sha256
`;

@Injectable()
export class ProfileRepository implements ProfileReadPort, ProfileAdminPort, ProfileAuthPort, ProfileContentPort, ProfileMasterPort, ProfileSanctionsPort {
  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {}

  async findById(userId: UserIdType): Promise<PublicProfile | null> {
    const result = await this.pool.query<ProfileRow>(`select id, username, display_name from users where id = $1`, [userId]);
    return result.rows[0] === undefined ? null : mapProfile(result.rows[0]);
  }

  async findByUsername(username: string): Promise<PublicProfile | null> {
    const result = await this.pool.query<ProfileRow>(`select id, username, display_name from users where username = $1`, [username]);
    return result.rows[0] === undefined ? null : mapProfile(result.rows[0]);
  }

  async findActiveByUsername(username: string): Promise<PublicProfile | null> {
    const result = await this.pool.query<ProfileRow>(`select id, username, display_name from users where username = $1 and status = 'active'`, [username]);
    return result.rows[0] === undefined ? null : mapProfile(result.rows[0]);
  }

  async findActiveByIds(userIds: readonly UserIdType[]): Promise<ReadonlyMap<UserIdType, PublicProfile>> {
    if (userIds.length === 0) return new Map();
    const result = await this.pool.query<ProfileRow>(`select id, username, display_name from users where id = any($1::uuid[]) and status = 'active'`, [userIds]);
    return new Map(result.rows.map((row) => [UserId(row.id), mapProfile(row)]));
  }

  async findAuthors(userIds: readonly UserIdType[]): Promise<ReadonlyMap<UserIdType, PublicContentAuthor>> {
    if (userIds.length === 0) return new Map();
    const result = await this.pool.query<{
      id: string;
      username: string;
      display_name: string | null;
      avatar_url: string | null;
      reputation_score: number;
      trust_level: number;
    }>(
      // Public-identity projection via the published contract view (task 6.0): physics-independent,
      // `user_id` aliased back to `id` to keep the port shape. This is the cross-domain author seam
      // (feed/community/makes read authors through PROFILE_CONTENT_PORT, never `users` directly).
      `select user_id as id, username, display_name, avatar_url, reputation_score, trust_level
       from identity_read_v1 where user_id = any($1::uuid[])`,
      [userIds],
    );
    return new Map(
      result.rows.map((row) => {
        const id = UserId(row.id);
        return [
          id,
          {
            id,
            username: row.username,
            displayName: row.display_name,
            avatarUrl: row.avatar_url,
            reputationScore: Number(row.reputation_score),
            trustLevel: Number(row.trust_level),
          },
        ];
      }),
    );
  }

  async trustState(userId: UserIdType): Promise<{ readonly trustLevel: number; readonly reputationScore: number; readonly createdAt: Date } | null> {
    const row = (
      await this.pool.query<{ trust_level: number; reputation_score: number; created_at: Date }>(
        `select trust_level,reputation_score,created_at from identity_read_v1 where user_id=$1`,
        [userId],
      )
    ).rows[0];
    return row === undefined ? null : { trustLevel: Number(row.trust_level), reputationScore: Number(row.reputation_score), createdAt: row.created_at };
  }

  async findSessionUser(userId: UserIdType): Promise<SessionProfile | null> {
    const result = await this.pool.query<SessionProfileRow>(
      `select id, username, display_name, avatar_url, handle_confirmed, role
       from users where id = $1 and status = 'active'`,
      [userId],
    );
    return result.rows[0] === undefined ? null : mapSession(result.rows[0]);
  }

  async loadOwnerAuthState(userId: UserIdType): Promise<{ readonly status: "active" | "banned" | "deleted"; readonly sessionVersion: number } | null> {
    const result = await this.pool.query<{ status: "active" | "banned" | "deleted"; session_version: number }>(
      `select status, session_version from users where id = $1`,
      [userId],
    );
    const row = result.rows[0];
    return row === undefined ? null : { status: row.status, sessionVersion: row.session_version };
  }

  async bumpSessionVersion(userId: UserIdType): Promise<boolean> {
    return (await this.pool.query(`update users set session_version = session_version + 1, updated_at = now() where id = $1`, [userId])).rowCount !== 0;
  }

  async restrictForSanction(tx: PoolClient, input: { readonly userId: UserIdType }): Promise<{ readonly changed: boolean; readonly sessionVersion: number }> {
    const result = await tx.query<{ session_version: number }>(
      `update users set status = 'restricted', session_version = session_version + 1, updated_at = now()
       where id = $1 and status = 'active' returning session_version`,
      [input.userId],
    );
    const row = result.rows[0];
    if (row !== undefined) return { changed: true, sessionVersion: row.session_version };
    const existing = await tx.query<{ session_version: number }>(`select session_version from users where id = $1`, [input.userId]);
    return { changed: false, sessionVersion: existing.rows[0]?.session_version ?? 0 };
  }

  async activateAfterSanctionExpiry(tx: PoolClient, input: { readonly userId: UserIdType }): Promise<{ readonly changed: boolean }> {
    const result = await tx.query(`update users set status = 'active', updated_at = now() where id = $1 and status = 'restricted'`, [input.userId]);
    return { changed: (result.rowCount ?? 0) > 0 };
  }

  async isBootstrapAdmin(tx: PoolClient, input: { readonly userId: UserIdType; readonly adminUsername: string }): Promise<boolean> {
    const result = await tx.query(`select 1 from users where id = $1 and username = $2`, [input.userId, input.adminUsername]);
    return (result.rowCount ?? 0) > 0;
  }

  async createUserWithFreeHandle(seed: NewUserSeed): Promise<UserIdType> {
    const base = /^[a-z0-9](?:[a-z0-9.]{1,30}[a-z0-9])?$/.test(seed.handle) ? seed.handle : `user${Date.now()}`;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const candidate = attempt === 0 ? base : `${base}${attempt + 1}`.slice(0, 32);
      const result = await this.pool.query<{ id: string }>(
        `insert into users (username, display_name, avatar_url, handle_confirmed)
         values ($1, $2, $3, false)
         on conflict (username) do nothing
         returning id`,
        [candidate, seed.displayName, seed.avatarUrl],
      );
      if (result.rows[0] !== undefined) return UserId(result.rows[0].id);
    }
    const fallback = `${base}.${randomBytes(3).toString("hex")}`.slice(0, 32);
    const result = await this.pool.query<{ id: string }>(
      `insert into users (username, display_name, avatar_url, handle_confirmed)
       values ($1, $2, $3, false) returning id`,
      [fallback, seed.displayName, seed.avatarUrl],
    );
    if (result.rows[0] === undefined) throw new Error("user insert returned no row");
    return UserId(result.rows[0].id);
  }

  async upsertDevUser(): Promise<SessionProfile | null> {
    const result = await this.pool.query<SessionProfileRow & { status: string }>(
      `insert into users (username, display_name, handle_confirmed)
       values ('devuser', 'DEV Reviewer', true)
       on conflict (username) do update set display_name = excluded.display_name, updated_at = now()
       returning id, username, display_name, avatar_url, handle_confirmed, role, status`,
    );
    const row = result.rows[0];
    return row === undefined || row.status !== "active" ? null : mapSession(row);
  }

  async isStaff(userId: UserIdType): Promise<boolean> {
    const result = await this.pool.query<{ is_staff: boolean }>(`select is_staff from users where id = $1`, [userId]);
    return result.rows[0]?.is_staff === true;
  }

  async role(userId: UserIdType): Promise<"user" | "researcher" | null> {
    const result = await this.pool.query<{ role: "user" | "researcher" }>(`select role from users where id = $1`, [userId]);
    return result.rows[0]?.role ?? null;
  }

  async findMasterState(userId: UserIdType): Promise<ProfileMasterState | null> {
    const result = await this.pool.query<{ id: string; is_master: boolean; master_profile: unknown }>(`select id, is_master, master_profile from users where id = $1`, [userId]);
    const row = result.rows[0];
    return row === undefined ? null : { id: UserId(row.id), isMaster: row.is_master, masterProfile: row.master_profile };
  }

  async becomeMaster(userId: UserIdType): Promise<ProfileMasterState | null> {
    const result = await this.pool.query<{ id: string; is_master: boolean; master_profile: unknown }>(
      `update users set is_master = true, updated_at = now() where id = $1
       returning id, is_master, master_profile`,
      [userId],
    );
    const row = result.rows[0];
    return row === undefined ? null : { id: UserId(row.id), isMaster: row.is_master, masterProfile: row.master_profile };
  }

  async updateMasterProfile(userId: UserIdType, profile: Readonly<Record<string, string | null>>): Promise<ProfileMasterState | null> {
    const result = await this.pool.query<{ id: string; is_master: boolean; master_profile: unknown }>(
      `update users set master_profile = $2, updated_at = now() where id = $1
       returning id, is_master, master_profile`,
      [userId, JSON.stringify(profile)],
    );
    const row = result.rows[0];
    return row === undefined ? null : { id: UserId(row.id), isMaster: row.is_master, masterProfile: row.master_profile };
  }

  async findActiveMaster(userId: UserIdType): Promise<PublicMasterProfile | null> {
    const result = await this.pool.query<{
      id: string;
      username: string;
      display_name: string | null;
      avatar_url: string | null;
      master_profile: unknown;
    }>(
      `select id, username, display_name, avatar_url, master_profile
       from users where id = $1 and is_master = true and status = 'active'`,
      [userId],
    );
    const row = result.rows[0];
    return row === undefined
      ? null
      : {
          id: UserId(row.id),
          username: row.username,
          displayName: row.display_name,
          avatarUrl: row.avatar_url,
          masterProfile: row.master_profile,
        };
  }

  async banUser(userId: UserIdType): Promise<{ readonly status: "banned"; readonly transitioned: boolean } | "not_found"> {
    const transitioned = await this.pool.query(
      `update users
       set status = 'banned', username = $2, display_name = null, avatar_url = null,
           avatar_s3_key = null, bio = null, website_url = null, contacts = '[]'::jsonb,
           session_version = session_version + 1, updated_at = now()
       where id = $1 and status <> 'banned'
       returning id`,
      [userId, `deleted.${randomBytes(6).toString("hex")}`],
    );
    if ((transitioned.rowCount ?? 0) > 0) return { status: "banned", transitioned: true };
    const existing = await this.pool.query(`select 1 from users where id = $1`, [userId]);
    return (existing.rowCount ?? 0) > 0 ? { status: "banned", transitioned: false } : "not_found";
  }

  async findProfilePage(username: string): Promise<ProfilePageRow | null> {
    const result = await this.pool.query<ProfilePageRow>(
      `select u.id, u.username, u.display_name, u.avatar_url, u.bio, u.website_url, u.contacts,
              u.handle_confirmed, u.role, u.reputation_score, u.trust_level, u.maker_verified
       from users u where u.username = $1 and u.status = 'active'`,
      [username],
    );
    return result.rows[0] ?? null;
  }

  async updateUser(userId: UserIdType, update: UserUpdate): Promise<UpdatedUser | null> {
    const sets: string[] = [];
    const values: unknown[] = [userId];
    const push = (column: string, value: unknown): void => {
      values.push(value);
      sets.push(`${column} = $${values.length}`);
    };
    if (update.username !== undefined) push("username", update.username);
    if (update.handleConfirmed !== undefined) push("handle_confirmed", update.handleConfirmed);
    if (update.displayName !== undefined) push("display_name", update.displayName);
    if (update.avatarUrl !== undefined) push("avatar_url", update.avatarUrl);
    if (update.clearAvatarKey === true) push("avatar_s3_key", null);
    if (update.bio !== undefined) push("bio", update.bio);
    if (update.websiteUrl !== undefined) push("website_url", update.websiteUrl);
    if (update.contacts !== undefined) push("contacts", JSON.stringify(update.contacts));
    const result = await this.pool.query<UpdatedUser>(
      `update users set ${sets.join(", ")}, updated_at = now() where id = $1
       returning id, username, display_name, avatar_url, bio, website_url, contacts, handle_confirmed`,
      values,
    );
    return result.rows[0] ?? null;
  }

  async activeAvatarKey(userId: UserIdType): Promise<string | null> {
    const result = await this.pool.query<{ avatar_s3_key: string | null }>(`select avatar_s3_key from users where id = $1 and status = 'active'`, [userId]);
    return result.rows[0]?.avatar_s3_key ?? null;
  }

  async replaceAvatarPhoto(userId: UserIdType, url: string, key: string): Promise<{ user: UpdatedUser | null; previousKey: string | null }> {
    const previous = await this.pool.query<{ avatar_s3_key: string | null }>(`select avatar_s3_key from users where id = $1`, [userId]);
    const result = await this.pool.query<UpdatedUser>(
      `update users set avatar_url = $2, avatar_s3_key = $3, updated_at = now() where id = $1
       returning id, username, display_name, avatar_url, bio, website_url, contacts, handle_confirmed`,
      [userId, url, key],
    );
    return { user: result.rows[0] ?? null, previousKey: previous.rows[0]?.avatar_s3_key ?? null };
  }

  async materializeAvatar(userId: UserIdType): Promise<AvatarRow | null> {
    const existing = await this.pool.query<AvatarRow>(
      `select ${AVATAR_SELECT} from user_avatar
       where user_id = $1 and exists (select 1 from users where id = $1 and status = 'active')`,
      [userId],
    );
    if (existing.rows[0] !== undefined) return { ...existing.rows[0], config: normalizeAvatarConfig(existing.rows[0].config, userId) };
    const active = await this.pool.query<{ id: string }>(`select id from users where id = $1 and status = 'active'`, [userId]);
    if (active.rows[0] === undefined) return null;
    await this.pool.query(`insert into user_avatar (user_id, config) values ($1, $2::jsonb) on conflict (user_id) do nothing`, [
      userId,
      JSON.stringify(deterministicAvatarConfig(userId)),
    ]);
    const result = await this.pool.query<AvatarRow>(`select ${AVATAR_SELECT} from user_avatar where user_id = $1`, [userId]);
    const row = result.rows[0];
    return row === undefined ? null : { ...row, config: normalizeAvatarConfig(row.config, userId) };
  }

  async updateAvatarCas(userId: UserIdType, currentRevision: number, config: AvatarConfig, keys: AvatarSnapshots, hashes: AvatarSnapshots): Promise<AvatarRow | null> {
    const result = await this.pool.query<AvatarRow>(
      `update user_avatar set config = $2, revision = $3,
         snapshot_left_s3_key = $4, snapshot_right_s3_key = $5, snapshot_front_s3_key = $6,
         snapshot_left_sha256 = $7, snapshot_right_sha256 = $8, snapshot_front_sha256 = $9, updated_at = now()
       where user_id = $1 and revision = $10 returning ${AVATAR_SELECT}`,
      [userId, JSON.stringify(config), currentRevision + 1, keys.left, keys.right, keys.front, hashes.left, hashes.right, hashes.front, currentRevision],
    );
    return result.rows[0] ?? null;
  }

  async currentSnapshot(userId: UserIdType, side: AvatarSnapshotSide): Promise<{ revision: number; sha256: string } | null> {
    const hashColumn = `snapshot_${side}_sha256`;
    const result = await this.pool.query<{ revision: string | number; sha256: string | null }>(
      `select ua.revision, ua.${hashColumn} as sha256 from user_avatar ua
       join users u on u.id = ua.user_id and u.status = 'active' where ua.user_id = $1`,
      [userId],
    );
    const row = result.rows[0];
    return row?.sha256 === null || row?.sha256 === undefined ? null : { revision: Number(row.revision), sha256: row.sha256 };
  }

  async snapshotKey(userId: UserIdType, revision: number, side: AvatarSnapshotSide, sha256: string): Promise<string | null> {
    const keyColumn = `snapshot_${side}_s3_key`;
    const hashColumn = `snapshot_${side}_sha256`;
    const result = await this.pool.query<{ key: string | null }>(
      `select ua.${keyColumn} as key from user_avatar ua
       join users u on u.id = ua.user_id and u.status = 'active'
       where ua.user_id = $1 and ua.revision = $2 and ua.${hashColumn} = $3`,
      [userId, revision, sha256],
    );
    return result.rows[0]?.key ?? null;
  }

  snapshots(userId: string, row: AvatarRow): AvatarSnapshots {
    const revision = Number(row.revision);
    const one = (side: AvatarSnapshotSide): string | null => {
      const key = row[`snapshot_${side}_s3_key`];
      const hash = row[`snapshot_${side}_sha256`];
      return key !== null && hash !== null ? avatarSnapshotUrl(userId, revision, side, hash) : null;
    };
    return { left: one("left"), right: one("right"), front: one("front") };
  }
}
