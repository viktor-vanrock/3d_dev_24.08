import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { ContentRestrictionsRepository } from "../infrastructure/content-restrictions.repository.ts";

const canRun = Boolean(process.env.DATABASE_URL);
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const repo = new ContentRestrictionsRepository(pool);
const ids: string[] = [];
let moderatorId: string;
async function create(subjectId: string, type: "hidden" | "locked" = "hidden") { const tx = await pool.connect(); try { await tx.query("begin"); const r = await repo.createIdempotent(tx, { subjectType: "post", subjectId, restrictionType: type, scope: "public", startedBy: moderatorId as never, startsAt: new Date(), endsAt: null, idempotencyKey: `restriction-${Date.now()}-${type}` }); await tx.query("commit"); return r.restriction; } catch (e) { await tx.query("rollback"); throw e; } finally { tx.release(); } }
describe.skipIf(!canRun)("ContentRestrictionsRepository", () => {
  beforeAll(async () => { moderatorId = (await pool.query<{ id: string }>("insert into users (username) values ($1) returning id", [`restriction-${Date.now()}`])).rows[0]!.id; });
  afterEach(async () => { if (ids.length) await pool.query("delete from content_restrictions where id=any($1::uuid[])", [ids.splice(0)]); });
  afterAll(async () => { if (moderatorId) await pool.query("delete from users where id=$1", [moderatorId]); await pool.end(); });
  it("finds an active restriction", async () => { const id = await create("00000000-0000-0000-0000-200000000001"); ids.push(id.id); await expect(repo.findActiveBySubject("post", id.subjectId)).resolves.toContainEqual(expect.objectContaining({ id: id.id })); });
  it("excludes a lifted restriction", async () => { const id = await create("00000000-0000-0000-0000-200000000002"); ids.push(id.id); const tx = await pool.connect(); await tx.query("begin"); await repo.lift(tx, { restrictionId: id.id, actorId: moderatorId as never, reason: "test" }); await tx.query("commit"); tx.release(); await expect(repo.findActiveBySubject("post", id.subjectId)).resolves.not.toContainEqual(expect.objectContaining({ id: id.id })); });
  it("allows different active restriction types", async () => { const subjectId = "00000000-0000-0000-0000-200000000003"; const hidden = await create(subjectId); const locked = await create(subjectId, "locked"); ids.push(hidden.id, locked.id); const active = await repo.findActiveBySubject("post", subjectId); expect(active.map(x => x.restrictionType)).toEqual(expect.arrayContaining(["hidden", "locked"])); });
});
