import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { pool } from "../../../db/client.ts";
import { SYSTEM_USER_ID, UserId } from "../../_kernel/brandedIds.ts";
import { ProfileRepository } from "./profile.repository.ts";

const createdIds: string[] = [];

async function insertUser(status: "active" | "restricted" | "deleted"): Promise<string> {
  const result = await pool.query<{ id: string }>(`insert into users (username, status) values ($1, $2) returning id`, [`identity-view-${randomUUID()}`, status]);
  const id = result.rows[0]!.id;
  createdIds.push(id);
  return id;
}

afterAll(async () => {
  if (createdIds.length > 0) await pool.query(`delete from users where id = any($1::uuid[])`, [createdIds]);
});

describe("identity read views", () => {
  it("keeps public identity active-only and hides the technical system actor", async () => {
    const active = await insertUser("active");
    const restricted = await insertUser("restricted");
    const deleted = await insertUser("deleted");
    const publicRows = await pool.query<{ user_id: string }>(`select user_id from identity_read_v1 where user_id = any($1::uuid[])`, [[active, restricted, deleted, SYSTEM_USER_ID]]);
    expect(publicRows.rows.map((row) => row.user_id)).toEqual([active]);
  });

  it("keeps all identities available to the staff/audit view", async () => {
    const restricted = await insertUser("restricted");
    const deleted = await insertUser("deleted");
    const rows = await pool.query<{ user_id: string }>(`select user_id from identity_read_all_v1 where user_id = any($1::uuid[]) order by user_id`, [[restricted, deleted, SYSTEM_USER_ID]]);
    expect(rows.rows.map((row) => row.user_id).sort()).toEqual([restricted, deleted, SYSTEM_USER_ID].sort());
  });

  it("keeps PROFILE_CONTENT_PORT public after the view gains its filter", async () => {
    const active = UserId(await insertUser("active"));
    const restricted = UserId(await insertUser("restricted"));
    const repository = new ProfileRepository(pool);
    const authors = await repository.findAuthors([active, restricted]);
    expect(authors.has(active)).toBe(true);
    expect(authors.has(restricted)).toBe(false);
  });
});
