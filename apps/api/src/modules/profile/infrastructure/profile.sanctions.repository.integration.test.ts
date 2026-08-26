import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { pool } from "../../../db/client.ts";
import { UserId } from "../../_kernel/brandedIds.ts";
import { ProfileRepository } from "./profile.repository.ts";

const created: string[] = [];
async function user(status: "active" | "deleted" = "active"): Promise<ReturnType<typeof UserId>> {
  const row = await pool.query<{ id: string }>(`insert into users(username, status, display_name, avatar_url, bio, contacts) values($1,$2,'Name','https://example.test/a','Bio','[{"label":"x","url":"https://example.test"}]') returning id`, [`profile-sanctions-${randomUUID()}`, status]);
  created.push(row.rows[0]!.id); return UserId(row.rows[0]!.id);
}
afterAll(async () => { if (created.length > 0) await pool.query(`delete from users where id = any($1::uuid[])`, [created]); });

describe("ProfileSanctionsPort", () => {
  it("restricts only active users without changing PII, and is idempotent", async () => {
    const id = await user(); const repo = new ProfileRepository(pool); const tx = await pool.connect();
    try {
      await tx.query("begin");
      await expect(repo.restrictForSanction(tx, { userId: id })).resolves.toMatchObject({ changed: true, sessionVersion: 2 });
      await expect(repo.restrictForSanction(tx, { userId: id })).resolves.toMatchObject({ changed: false, sessionVersion: 2 });
      const row = await tx.query(`select status, username, display_name, avatar_url, bio, contacts, session_version from users where id=$1`, [id]);
      expect(row.rows[0]).toMatchObject({ status: "restricted", display_name: "Name", avatar_url: "https://example.test/a", bio: "Bio", session_version: 2 });
      await tx.query("commit");
    } finally { tx.release(); }
  });
  it("leaves deleted users unchanged and rolls back external transactions", async () => {
    const deleted = await user("deleted"); const active = await user(); const repo = new ProfileRepository(pool); const tx = await pool.connect();
    try {
      await tx.query("begin");
      await expect(repo.restrictForSanction(tx, { userId: deleted })).resolves.toMatchObject({ changed: false });
      await repo.restrictForSanction(tx, { userId: active }); await tx.query("rollback");
    } finally { tx.release(); }
    await expect(pool.query(`select status, session_version from users where id=$1`, [active])).resolves.toMatchObject({ rows: [{ status: "active", session_version: 1 }] });
  });
  it("reactivates only restricted users and identifies bootstrap username", async () => {
    const id = await user(); const repo = new ProfileRepository(pool); const tx = await pool.connect();
    try {
      await tx.query("begin"); await repo.restrictForSanction(tx, { userId: id });
      await expect(repo.activateAfterSanctionExpiry(tx, { userId: id })).resolves.toEqual({ changed: true });
      await expect(repo.activateAfterSanctionExpiry(tx, { userId: id })).resolves.toEqual({ changed: false });
      await expect(repo.isBootstrapAdmin(tx, { userId: id, adminUsername: `profile-sanctions-${randomUUID()}` })).resolves.toBe(false);
      await tx.query("commit");
    } finally { tx.release(); }
  });
});
