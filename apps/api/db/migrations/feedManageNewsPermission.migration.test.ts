import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { describe, expect, it } from "vitest";

const DATABASE_URL = process.env.DATABASE_URL;
const ENABLED = process.env.FEED_MANAGE_NEWS_SCHEMA_TEST === "1";
const migrationPath = fileURLToPath(new URL("./20260914180000_feed_manage_news_permission.sql", import.meta.url));

function sections(sql: string): { readonly up: string; readonly down: string } {
  const [upSection, down] = sql.split("-- migrate:down");
  if (upSection === undefined || down === undefined) throw new Error("feed permission migration must contain up and down sections");
  return { up: upSection.replace("-- migrate:up", "").trim(), down: down.trim() };
}

describe("feed.manage_news permission migration", () => {
  it("contains no implicit grants or destructive rollback", async () => {
    const { up, down } = sections(await readFile(migrationPath, "utf8"));
    expect(up.toLowerCase()).not.toContain("insert into public.permission_grants");
    expect(up.toLowerCase()).not.toContain("insert into public.audit_log");
    expect(down.toLowerCase()).not.toContain("delete from");
  });

  it.skipIf(!DATABASE_URL || !ENABLED)("preserves an explicitly provisioned grant and audit record on rollback", async () => {
    const pool = new Pool({ connectionString: DATABASE_URL });
    const client = await pool.connect();
    const { up, down } = sections(await readFile(migrationPath, "utf8"));
    const userId = randomUUID();
    try {
      const database = await client.query<{ name: string }>("select current_database() as name");
      const name = database.rows[0]?.name ?? "";
      if (["portal", "portal_dev", "postgres"].includes(name) || !/(?:^test_|^sandbox_|_test$|_sandbox$)/.test(name)) throw new Error(`refusing permission migration test against non-disposable database '${name}'`);
      await client.query("begin");
      await client.query(down);
      await client.query("insert into users(id,username,is_staff) values($1,$2,true)", [userId, `feed-permission-${userId}`]);
      await client.query(up);
      const implicit = await client.query("select 1 from permission_grants where user_id=$1", [userId]);
      expect(implicit.rowCount).toBe(0);
      const grant = await client.query<{ id: string }>("insert into permission_grants(user_id,permission,granted_by,reason) values($1,'feed.manage_news',$1,'explicit test grant') returning id", [userId]);
      const grantId = grant.rows[0]?.id;
      if (grantId === undefined) throw new Error("explicit permission grant was not created");
      await client.query("insert into audit_log(actor_user_id,action,target_type,target_id,details) values($1,'permission.granted','permission_grant',$2,$3)", [userId, grantId, JSON.stringify({ reason: "explicit test grant" })]);
      await client.query(down);
      expect((await client.query("select 1 from permission_grants where id=$1", [grantId])).rowCount).toBe(1);
      expect((await client.query("select 1 from audit_log where target_id=$1", [grantId])).rowCount).toBe(1);
    } finally {
      await client.query("rollback").catch(() => undefined);
      client.release();
      await pool.end();
    }
  });
});
