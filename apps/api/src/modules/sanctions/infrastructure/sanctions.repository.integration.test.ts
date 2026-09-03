import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pool } from "../../../db/client.ts";
import { SYSTEM_USER_ID, UserId } from "../../_kernel/brandedIds.ts";
import { sanctionIdempotencyPayloadHash } from "../domain/sanctions.ts";
import { SanctionsRepository } from "./sanctions.repository.ts";

const createdUsers: string[] = [];
const createdSanctions: string[] = [];
let repository: SanctionsRepository;

async function createUser(): Promise<ReturnType<typeof UserId>> {
  const result = await pool.query<{ id: string }>(`insert into users (username) values ($1) returning id`, [`sanctions-test-${randomUUID()}`]);
  const id = UserId(result.rows[0]!.id);
  createdUsers.push(id);
  return id;
}

describe("SanctionsRepository", () => {
  beforeAll(() => { repository = new SanctionsRepository(pool); });
  afterAll(async () => {
    if (createdSanctions.length > 0) await pool.query(`delete from sanction_appeals where sanction_id = any($1::uuid[])`, [createdSanctions]);
    if (createdSanctions.length > 0) await pool.query(`delete from sanctions where id = any($1::uuid[])`, [createdSanctions]);
    if (createdUsers.length > 0) await pool.query(`delete from users where id = any($1::uuid[])`, [createdUsers]);
  });

  it("persists sanctions and exposes active and history reads", async () => {
    const target = await createUser();
    const endsAt = new Date("2029-02-01T00:00:00.000Z");
    const sanction = await repository.insertSanction({
      userId: target, type: "suspension", state: "active", reasonCode: "spam", reasonNote: "fixture", evidenceUrl: null,
      startsAt: new Date("2029-01-01T00:00:00.000Z"), endsAt, createdBy: SYSTEM_USER_ID, cancelledAt: null, cancelledBy: null, cancelReason: null,
      idempotencyKey: randomUUID(), idempotencyPayloadHash: sanctionIdempotencyPayloadHash({ userId: target, type: "suspension", reasonCode: "spam", endsAt }),
    });
    createdSanctions.push(sanction.id);
    await expect(repository.findActiveForUser(target)).resolves.toMatchObject({ id: sanction.id, state: "active" });
    const tx = await pool.connect();
    try {
      await tx.query("begin");
      await expect(repository.findActiveForUserTx(tx, target)).resolves.toMatchObject({ id: sanction.id, state: "active" });
      await tx.query("commit");
    } finally { tx.release(); }
    await expect(repository.listHistoryForUser(target)).resolves.toMatchObject([{ id: sanction.id }]);
  });

  it("lets PostgreSQL enforce active-sanction and pending-appeal partial uniqueness", async () => {
    const target = await createUser();
    const sanction = await repository.insertSanction({
      userId: target, type: "ban", state: "active", reasonCode: "fraud", reasonNote: null, evidenceUrl: null, startsAt: new Date(), endsAt: null,
      createdBy: SYSTEM_USER_ID, cancelledAt: null, cancelledBy: null, cancelReason: null, idempotencyKey: randomUUID(),
      idempotencyPayloadHash: sanctionIdempotencyPayloadHash({ userId: target, type: "ban", reasonCode: "fraud", endsAt: null }),
    });
    createdSanctions.push(sanction.id);
    await expect(repository.insertSanction({ ...sanction, idempotencyKey: randomUUID() })).rejects.toMatchObject({ code: "23505" });
    await repository.insertAppeal({ sanctionId: sanction.id, submittedBy: target, message: "please review", state: "pending", resolvedBy: null, resolvedAt: null, resolutionNote: null });
    await expect(repository.insertAppeal({ sanctionId: sanction.id, submittedBy: target, message: "again", state: "pending", resolvedBy: null, resolvedAt: null, resolutionNote: null })).rejects.toMatchObject({ code: "23505" });
  });

  it("has the migration-created system actor with no password credential", async () => {
    await expect(pool.query<{ username: string; status: string }>(`select username, status from users where id = $1`, [SYSTEM_USER_ID])).resolves.toMatchObject({ rows: [{ username: "__system__", status: "active" }] });
    await expect(pool.query(`select 1 from user_password_credentials where user_id = $1`, [SYSTEM_USER_ID])).resolves.toMatchObject({ rowCount: 0 });
  });
});
