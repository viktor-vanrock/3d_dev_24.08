import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { UserId } from "../../_kernel/brandedIds.ts";
import { Permissions } from "../domain/permissions.catalog.ts";
import { PermissionGrantsPgRepository } from "./permission-grants.repository.ts";

const DATABASE_URL = process.env.DATABASE_URL;

describe.skipIf(!DATABASE_URL)("PermissionGrantsPgRepository bootstrap concurrency", () => {
  const pool = new Pool({ connectionString: DATABASE_URL });
  const repository = new PermissionGrantsPgRepository(pool);
  const userId = UserId(randomUUID());
  const username = `permission-bootstrap-${userId}`;
  const reason = "bootstrap concurrency integration test";
  const input = { userId, permissions: [Permissions.CATALOG_EDIT_ANY], reason };

  beforeAll(async () => {
    await pool.query(`insert into users(id,username,status) values($1,$2,'active')`, [userId, username]);
  });

  afterAll(async () => {
    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query(
        `delete from audit_log where target_type='permission_grant'
           and target_id in (select id from permission_grants where user_id=$1 and reason=$2)`,
        [userId, reason],
      );
      await client.query(`delete from permission_grants where user_id=$1 and reason=$2`, [userId, reason]);
      await client.query(`delete from users where id=$1`, [userId]);
      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
      await pool.end();
    }
  });

  it("создаёт ровно один active global grant при конкурентном bootstrap", async () => {
    const outcomes = await Promise.all([repository.ensureBootstrapPermissions(input), repository.ensureBootstrapPermissions(input)]);

    expect(outcomes).toEqual(
      expect.arrayContaining([
        { created: 1, skipped: 0 },
        { created: 0, skipped: 1 },
      ]),
    );
    const grants = await pool.query<{ id: string }>(
      `select id from permission_grants where user_id=$1 and permission=$2 and scope='{}'::jsonb
         and revoked_at is null and (expires_at is null or expires_at>now())`,
      [userId, Permissions.CATALOG_EDIT_ANY],
    );
    expect(grants.rows).toHaveLength(1);
    const audits = await pool.query(`select 1 from audit_log where action='permission.granted' and target_type='permission_grant' and target_id=$1`, [grants.rows[0]?.id]);
    expect(audits.rowCount).toBe(1);

    await expect(repository.ensureBootstrapPermissions(input)).resolves.toEqual({ created: 0, skipped: 1 });
  });
});
