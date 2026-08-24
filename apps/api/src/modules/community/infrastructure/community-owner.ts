import type { PoolClient, QueryResult, QueryResultRow } from "pg";
import { pool } from "../../../db/client.ts";

export type VoteSubjectType = "thread" | "post" | "feed_post" | "feed_comment" | "make";

export async function findOwnedVoteForUpdate(client: PoolClient, subjectType: VoteSubjectType, subjectId: string, userId: string): Promise<{ value: number } | null> {
  const result = await client.query<{ value: number }>(`select value from votes where subject_type = $1 and subject_id = $2 and user_id = $3 for update`, [
    subjectType,
    subjectId,
    userId,
  ]);
  return result.rows[0] ?? null;
}

export async function insertOwnedVote(client: PoolClient, subjectType: VoteSubjectType, subjectId: string, userId: string, value: number, trustSnapshot?: number): Promise<void> {
  if (trustSnapshot === undefined) {
    await client.query(`insert into votes (subject_type, subject_id, user_id, value) values ($1, $2, $3, $4)`, [subjectType, subjectId, userId, value]);
    return;
  }
  await client.query(`insert into votes (subject_type, subject_id, user_id, value, trust_snapshot) values ($1, $2, $3, $4, $5)`, [
    subjectType,
    subjectId,
    userId,
    value,
    trustSnapshot,
  ]);
}

export async function updateOwnedVote(client: PoolClient, subjectType: VoteSubjectType, subjectId: string, userId: string, value: number, trustSnapshot?: number): Promise<void> {
  if (trustSnapshot === undefined) {
    await client.query(`update votes set value = $4 where subject_type = $1 and subject_id = $2 and user_id = $3`, [subjectType, subjectId, userId, value]);
    return;
  }
  await client.query(`update votes set value = $4, trust_snapshot = $5 where subject_type = $1 and subject_id = $2 and user_id = $3`, [
    subjectType,
    subjectId,
    userId,
    value,
    trustSnapshot,
  ]);
}

export async function deleteOwnedVote(client: PoolClient, subjectType: VoteSubjectType, subjectId: string, userId: string): Promise<void> {
  await client.query(`delete from votes where subject_type = $1 and subject_id = $2 and user_id = $3`, [subjectType, subjectId, userId]);
}

export async function countOwnedPositiveVotes(client: PoolClient, subjectType: VoteSubjectType, subjectId: string): Promise<number> {
  const result = await client.query<{ count: number }>(`select count(*)::int as count from votes where subject_type = $1 and subject_id = $2 and value = 1`, [
    subjectType,
    subjectId,
  ]);
  return result.rows[0]?.count ?? 0;
}

export async function aggregateOwnedVotes(
  client: PoolClient,
  subjectType: VoteSubjectType,
  subjectId: string,
): Promise<{ up: number; down: number; upWeighted: number; downWeighted: number }> {
  const result = await client.query<{ up: number; down: number; up_weighted: number; down_weighted: number }>(
    `select
       count(*) filter (where value = 1)::int as up,
       count(*) filter (where value = -1)::int as down,
       coalesce(sum(coalesce(trust_snapshot, 1)) filter (where value = 1), 0)::float8 as up_weighted,
       coalesce(sum(coalesce(trust_snapshot, 1)) filter (where value = -1), 0)::float8 as down_weighted
     from votes where subject_type = $1 and subject_id = $2`,
    [subjectType, subjectId],
  );
  const row = result.rows[0];
  return {
    up: row?.up ?? 0,
    down: row?.down ?? 0,
    upWeighted: row?.up_weighted ?? 0,
    downWeighted: row?.down_weighted ?? 0,
  };
}

export async function ensureOwnedTag(name: string): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `insert into tags (name) values ($1)
     on conflict (name) do update set name = excluded.name
     returning id`,
    [name],
  );
  return result.rows[0]!.id;
}

interface CommunityOwnerExecutor {
  query<R extends QueryResultRow = QueryResultRow>(text: string, values?: readonly unknown[]): Promise<QueryResult<R>>;
}

export async function ensureOwnedTags(names: readonly string[], executor: CommunityOwnerExecutor = pool): Promise<readonly string[]> {
  if (names.length === 0) return [];
  const result = await executor.query<{ id: string }>(
    `insert into tags (name)
     select unnest($1::text[])
     on conflict (name) do update set name = excluded.name
     returning id`,
    [names],
  );
  return result.rows.map((row) => row.id);
}

export async function findOwnedTagNames(tagIds: readonly string[]): Promise<ReadonlyMap<string, string>> {
  if (tagIds.length === 0) return new Map();
  const result = await pool.query<{ id: string; name: string }>(`select id, name from tags where id = any($1::uuid[])`, [tagIds]);
  return new Map(result.rows.map((row) => [row.id, row.name]));
}

export interface OwnedTagSearchRecord {
  readonly id: string;
  readonly name: string;
  readonly score: number;
}

export async function searchOwnedTags(query: string, limit: number): Promise<readonly OwnedTagSearchRecord[]> {
  const result = await pool.query<{ id: string; name: string; score: number }>(
    `select id, name, similarity(lower(name), lower($1))::float8 as score
       from tags where name ilike $2 order by score desc, name limit $3`,
    [query, `%${query}%`, limit],
  );
  return result.rows;
}

export async function findOwnedTagIds(names: readonly string[]): Promise<ReadonlyMap<string, string>> {
  if (names.length === 0) return new Map();
  const rows = (await pool.query<{ id: string; name: string }>(`select id, name from tags where name = any($1::text[])`, [names])).rows;
  return new Map(rows.map((row) => [row.name, row.id]));
}

export async function listOwnedTags(prefix: string, limit: number): Promise<readonly { readonly id: string; readonly name: string }[]> {
  return (
    await pool.query<{ id: string; name: string }>(
      prefix === "" ? `select id, name from tags order by name limit $1` : `select id, name from tags where name like $1 order by name limit $2`,
      prefix === "" ? [limit] : [`${prefix}%`, limit],
    )
  ).rows;
}

export async function addOwnedCommunityMember(
  client: PoolClient,
  communityId: string,
  userId: string,
  role: "owner" | "moderator" | "member",
  source: "manual" | "vendor_claim",
): Promise<QueryResult> {
  return client.query(
    `insert into community_members (community_id, user_id, role, source) values ($1, $2, $3, $4)
     on conflict (community_id, user_id) do update set role = excluded.role, source = excluded.source`,
    [communityId, userId, role, source],
  );
}

export async function removeOwnedCommunityMember(client: PoolClient, communityId: string, userId: string): Promise<QueryResult> {
  return client.query(`delete from community_members where community_id = $1 and user_id = $2`, [communityId, userId]);
}

export async function grantOwnedCommunityRole(
  communityId: string,
  userId: string,
  role: "owner" | "moderator" | "member",
  source: "manual" | "vendor_claim",
): Promise<typeof role> {
  const result = await pool.query<{ role: typeof role }>(
    `insert into community_members (community_id, user_id, role, source) values ($1, $2, $3, $4)
     on conflict (community_id, user_id) do update set role = excluded.role, source = excluded.source
     returning role`,
    [communityId, userId, role, source],
  );
  return result.rows[0]!.role;
}
