import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { pool } from "../../../db/client.ts";
import { ProjectsOutboxRepository } from "./outbox.repository.ts";

const ids: string[] = [];
afterAll(async () => { if (ids.length > 0) await pool.query(`delete from outbox_events where id = any($1::uuid[])`, [ids]); });
describe("OutboxPort", () => {
  it("enqueues within caller transaction and rolls back with it", async () => {
    const outbox = new ProjectsOutboxRepository(pool); const tx = await pool.connect(); const aggregateId = randomUUID();
    try { await tx.query("begin"); const event = await outbox.enqueue(tx, { aggregateType: "Sanction", aggregateId, eventType: "sanction.test.v1", eventVersion: 1, payload: { a: 1 } }); ids.push(event.id); await tx.query("rollback");
      await expect(pool.query(`select 1 from outbox_events where id=$1`, [event.id])).resolves.toMatchObject({ rowCount: 0 });
    } finally { tx.release(); }
  });
  it("claims, completes, retries and reclaims leased events", async () => {
    const outbox = new ProjectsOutboxRepository(pool); const tx = await pool.connect(); let id: string;
    try { await tx.query("begin"); id = (await outbox.enqueue(tx, { aggregateType: "Sanction", aggregateId: randomUUID(), eventType: "sanction.test.v1", eventVersion: 1, payload: { id: 1 } })).id; ids.push(id); await tx.query("commit"); } finally { tx.release(); }
    await expect(outbox.claim({ limit: 10, workerId: "one", leaseSeconds: 60, eventTypes: ["sanction.test.v1"] })).resolves.toMatchObject([{ id }]);
    await expect(outbox.claim({ limit: 10, workerId: "two", leaseSeconds: 60 })).resolves.toEqual([]);
    await outbox.retry({ eventId: id!, workerId: "one", availableAt: new Date(Date.now() - 1), lastErrorSafe: "safe" });
    await expect(outbox.claim({ limit: 10, workerId: "two", leaseSeconds: 60 })).resolves.toMatchObject([{ id, attemptCount: 1 }]);
    await outbox.complete({ eventId: id!, workerId: "two" });
    await expect(pool.query(`select completed_at, locked_by from outbox_events where id=$1`, [id])).resolves.toMatchObject({ rows: [{ locked_by: null }] });
  });
});
