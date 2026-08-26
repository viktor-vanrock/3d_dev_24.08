import type { PoolClient } from "pg";
import { pool } from "../../../db/client.ts";

export interface OwnedUserSummary {
  readonly id: string;
  readonly username: string;
}

export interface ClaimedBootstrapAdminUser {
  readonly id: string;
  readonly created: boolean;
}

export async function claimBootstrapAdminUser(client: PoolClient, username: string): Promise<ClaimedBootstrapAdminUser> {
  const inserted = await client.query<{ id: string }>(
    `insert into users (username, display_name, status, handle_confirmed, is_staff)
     values ($1, $1, 'active', true, true)
     on conflict (username) do nothing
     returning id`,
    [username],
  );
  const insertedId = inserted.rows[0]?.id;
  if (insertedId !== undefined) return { id: insertedId, created: true };

  const existing = await client.query<{ id: string }>(`select id from users where username = $1 for update`, [username]);
  const row = existing.rows[0];
  if (row === undefined) throw new Error("ADMIN_USERNAME disappeared while claiming bootstrap ownership");
  return { id: row.id, created: false };
}

export async function activateBootstrapAdminUser(client: PoolClient, userId: string, hasActiveSanction: boolean): Promise<void> {
  await client.query(
    `update users
     set handle_confirmed = true,
         is_staff = true,
         status = case when $2 then status else 'active' end,
         session_version = case when $2 then session_version else session_version + 1 end,
         updated_at = now()
     where id = $1`,
    [userId, hasActiveSanction],
  );
}

export interface OwnedMasterRow<TProfile = unknown> {
  readonly id: string;
  readonly is_master: boolean;
  readonly master_profile: TProfile;
}

export async function upsertDevUser(): Promise<OwnedUserSummary | null> {
  const result = await pool.query<{ id: string; username: string; status: string }>(
    `insert into users (username, display_name, handle_confirmed)
     values ('devuser', 'DEV Reviewer', true)
     on conflict (username) do update set display_name = excluded.display_name, updated_at = now()
     returning id, username, status`,
  );
  const row = result.rows[0];
  return row !== undefined && row.status === "active" ? { id: row.id, username: row.username } : null;
}

export async function becomeMaster<TProfile = unknown>(userId: string): Promise<OwnedMasterRow<TProfile> | null> {
  const result = await pool.query<OwnedMasterRow<TProfile>>(
    `update users set is_master = true, updated_at = now() where id = $1
     returning id, is_master, master_profile`,
    [userId],
  );
  return result.rows[0] ?? null;
}

export async function updateOwnedMasterProfile<TProfile extends object>(userId: string, masterProfile: TProfile): Promise<OwnedMasterRow<TProfile> | null> {
  const result = await pool.query<OwnedMasterRow<TProfile>>(
    `update users set master_profile = $2, updated_at = now() where id = $1
     returning id, is_master, master_profile`,
    [userId, JSON.stringify(masterProfile)],
  );
  return result.rows[0] ?? null;
}

export async function lockOwnedUser(client: PoolClient, userId: string): Promise<boolean> {
  const result = await client.query(`select id from users where id = $1 for update`, [userId]);
  return (result.rowCount ?? 0) > 0;
}

export async function incrementOwnedReputation(client: PoolClient, userId: string, delta: number): Promise<void> {
  await client.query(`update users set reputation_score = reputation_score + $2 where id = $1`, [userId, delta]);
}

export async function setOwnedTrustLevel(userId: string, level: number): Promise<void> {
  await pool.query(`update users set trust_level = $2 where id = $1`, [userId, level]);
}

export async function isOwnedStaff(userId: string): Promise<boolean> {
  return (await pool.query<{ is_staff: boolean }>(`select is_staff from users where id = $1`, [userId])).rows[0]?.is_staff === true;
}

export interface OwnedContentAuthor {
  readonly id: string;
  readonly username: string;
  readonly displayName: string | null;
  readonly avatarUrl: string | null;
}

export async function findOwnedContentAuthors(userIds: readonly string[]): Promise<ReadonlyMap<string, OwnedContentAuthor>> {
  if (userIds.length === 0) return new Map();
  const rows = (
    await pool.query<{ id: string; username: string; display_name: string | null; avatar_url: string | null }>(
      `select user_id as id, username, display_name, avatar_url from identity_read_v1 where user_id = any($1::uuid[])`,
      [userIds],
    )
  ).rows;
  return new Map(
    rows.map((row) => [
      row.id,
      {
        id: row.id,
        username: row.username,
        displayName: row.display_name,
        avatarUrl: row.avatar_url,
      },
    ]),
  );
}

export async function getOwnedTrustState(userId: string): Promise<{
  readonly reputation_score: number;
  readonly trust_level: number;
  readonly trust_level_manual: boolean;
} | null> {
  const result = await pool.query<{
    reputation_score: number;
    trust_level: number;
    trust_level_manual: boolean;
  }>(`select reputation_score, trust_level, trust_level_manual from users where id = $1`, [userId]);
  return result.rows[0] ?? null;
}

export async function markOwnedActivationHasPrinter(client: PoolClient, userId: string, hasPrinter: boolean): Promise<void> {
  await client.query(`update user_activation set has_printer = $2, updated_at = now() where user_id = $1`, [userId, hasPrinter]);
}
