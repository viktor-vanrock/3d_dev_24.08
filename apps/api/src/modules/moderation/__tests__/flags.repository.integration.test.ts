import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { FlagsRepository } from "../infrastructure/flags.repository.ts";

const canRun = Boolean(process.env.DATABASE_URL);
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const repo = new FlagsRepository(pool);
const ids: string[] = [];
let userId: string;

async function create(input: Partial<{ subjectId: string; key: string }> = {}) {
  const tx = await pool.connect();
  try {
    await tx.query("begin");
    const result = await repo.createIdempotent(tx, { subjectType: "post", subjectId: input.subjectId ?? "00000000-0000-0000-0000-100000000001", reporterId: userId as never, reasonCode: "spam", reasonText: null, subjectSnapshot: {}, priority: 20, dueAt: new Date(Date.now() + 3600000), idempotencyKey: input.key ?? `flag-${Date.now()}`, evidence: [] });
    await tx.query("commit");
    return result;
  } catch (error) { await tx.query("rollback"); throw error; } finally { tx.release(); }
}

describe.skipIf(!canRun)("FlagsRepository", () => {
  beforeAll(async () => { userId = (await pool.query<{ id: string }>("insert into users (username) values ($1) returning id", [`flags-${Date.now()}`])).rows[0]!.id; });
  afterEach(async () => { if (ids.length) await pool.query("delete from reports where id = any($1::uuid[])", [ids.splice(0)]); });
  afterAll(async () => { if (userId) await pool.query("delete from users where id=$1", [userId]); await pool.end(); });
  it("creates flag, returns created=true", async () => { const { flag, created } = await create(); ids.push(flag.id); expect(created).toBe(true); });
  it("idempotent: same key returns same flag", async () => { const key = `idem-${Date.now()}`; const first = await create({ key }); ids.push(first.flag.id); const second = await create({ key }); expect(second).toMatchObject({ created: false, flag: { id: first.flag.id } }); });
  it("throws 409 when an open flag exists", async () => { const subjectId = "00000000-0000-0000-0000-100000000003"; const first = await create({ subjectId }); ids.push(first.flag.id); await expect(create({ subjectId })).rejects.toMatchObject({ status: 409 }); });
  it("allows a new flag after resolution", async () => { const subjectId = "00000000-0000-0000-0000-100000000004"; const first = await create({ subjectId }); ids.push(first.flag.id); await pool.query("update reports set status='resolved' where id=$1", [first.flag.id]); const second = await create({ subjectId }); ids.push(second.flag.id); expect(second.created).toBe(true); });
});
