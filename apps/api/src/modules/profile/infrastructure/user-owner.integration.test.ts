import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { pool } from "../../../db/client.ts";
import { activateBootstrapAdminUser } from "./user-owner.ts";

const users: string[] = [];

async function createUser(status: "active" | "restricted"): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `insert into users(username, status, is_staff, handle_confirmed, session_version)
     values ($1, $2, false, false, 7) returning id`,
    [`bootstrap-owner-${randomUUID()}`, status],
  );
  const id = result.rows[0]!.id;
  users.push(id);
  return id;
}

afterAll(async () => {
  if (users.length > 0) await pool.query(`delete from users where id = any($1::uuid[])`, [users]);
});

describe("activateBootstrapAdminUser", () => {
  it("keeps a sanctioned bootstrap account restricted without changing its session version", async () => {
    const id = await createUser("restricted");
    const client = await pool.connect();
    try {
      await activateBootstrapAdminUser(client, id, true);
    } finally {
      client.release();
    }
    await expect(pool.query(`select status, is_staff, handle_confirmed, session_version from users where id = $1`, [id])).resolves.toMatchObject({
      rows: [{ status: "restricted", is_staff: true, handle_confirmed: true, session_version: 7 }],
    });
  });

  it("activates an unsanctioned bootstrap account and invalidates prior sessions", async () => {
    const id = await createUser("restricted");
    const client = await pool.connect();
    try {
      await activateBootstrapAdminUser(client, id, false);
    } finally {
      client.release();
    }
    await expect(pool.query(`select status, is_staff, handle_confirmed, session_version from users where id = $1`, [id])).resolves.toMatchObject({
      rows: [{ status: "active", is_staff: true, handle_confirmed: true, session_version: 8 }],
    });
  });
});
