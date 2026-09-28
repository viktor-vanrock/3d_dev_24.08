import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { AuditLogService } from "../../audit/application/audit-log.service.ts";
import { PostgresAuditLogRepository } from "../../audit/infrastructure/postgres-audit-log.repository.ts";
import { SanctionsRepository } from "../../sanctions/infrastructure/sanctions.repository.ts";
import { ModerationService } from "../application/moderation.service.ts";
import { FlagClaimsRepository } from "../infrastructure/flag-claims.repository.ts";
import { ContentRestrictionsRepository } from "../infrastructure/content-restrictions.repository.ts";
import { FlagsRepository } from "../infrastructure/flags.repository.ts";
import { ModerationDecisionsRepository } from "../infrastructure/moderation-decisions.repository.ts";

const canRun = Boolean(process.env.DATABASE_URL);
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const service = new ModerationService(
  pool,
  new FlagsRepository(pool),
  new FlagClaimsRepository(pool),
  new ModerationDecisionsRepository(pool),
  new ContentRestrictionsRepository(pool),
  new AuditLogService(new PostgresAuditLogRepository(pool)),
  new SanctionsRepository(pool),
);
const flagIds: string[] = [];
let userId: string;
let moderatorId: string;

async function createUser(username: string): Promise<string> {
  return (await pool.query<{ id: string }>("insert into users (username) values ($1) returning id", [username])).rows[0]!.id;
}

async function createFlag(): Promise<string> {
  const { flag } = await service.submitFlag({
    reporterId: userId as never,
    subjectType: "post",
    subjectId: randomUUID(),
    reasonCode: "spam",
    reasonText: null,
    subjectSnapshot: {},
    evidence: [],
    idempotencyKey: `reversal-${randomUUID()}`,
  });
  flagIds.push(flag.id);
  return flag.id;
}

async function cleanup(): Promise<void> {
  const userIds = [userId, moderatorId].filter(Boolean);
  if (flagIds.length) {
    await pool.query("delete from moderation_decisions where flag_id = any($1::uuid[])", [flagIds]);
    await pool.query("delete from flag_claims where flag_id = any($1::uuid[])", [flagIds]);
    await pool.query("delete from content_restrictions where started_by = any($1::uuid[])", [userIds]);
    await pool.query("delete from reports where id = any($1::uuid[])", [flagIds.splice(0)]);
  }
}

describe.skipIf(!canRun)("Moderation permissions and reversal", () => {
  beforeAll(async () => {
    userId = await createUser(`reversal-user-${randomUUID()}`);
    moderatorId = await createUser(`reversal-moderator-${randomUUID()}`);
  });

  afterEach(cleanup);
  afterAll(async () => {
    await cleanup();
    await pool.end();
  });

  it("leaves legacy moderation_actions unchanged", async () => {
    const before = await pool.query<{ cnt: number }>("select count(*)::int as cnt from moderation_actions");
    const flagId = await createFlag();
    await service.claimFlag({
      flagId,
      moderatorId: moderatorId as never,
      idempotencyKey: `legacy-claim-${randomUUID()}`,
    });
    await service.decideFlag({
      flagId,
      moderatorId: moderatorId as never,
      action: "dismiss",
      reasonCode: "spam",
      reasonNote: null,
      idempotencyKey: `legacy-decision-${randomUUID()}`,
    });
    const after = await pool.query<{ cnt: number }>("select count(*)::int as cnt from moderation_actions");

    expect(after.rows[0]!.cnt).toBe(before.rows[0]!.cnt);
  });

  it("reverses a decision and records an audit event", async () => {
    const flagId = await createFlag();
    const decision = await service.decideFlag({
      flagId,
      moderatorId: moderatorId as never,
      action: "dismiss",
      reasonCode: "spam",
      reasonNote: null,
      idempotencyKey: `reverse-decision-${randomUUID()}`,
    });

    await service.reverseDecision({
      decisionId: decision.decision.id,
      actorId: moderatorId as never,
      reason: "mistake",
      idempotencyKey: `reverse-${randomUUID()}`,
    });

    const { rows: decisions } = await pool.query<{ reversed_at: Date | null }>("select reversed_at from moderation_decisions where id = $1", [decision.decision.id]);
    expect(decisions[0]!.reversed_at).not.toBeNull();
    const { rows: auditEvents } = await pool.query<{ cnt: number }>(
      `select count(*)::int as cnt from audit_log
       where action = 'flag.decision_reversed' and (after_state->>'decisionId') = $1`,
      [decision.decision.id],
    );
    expect(auditEvents[0]!.cnt).toBe(1);
  });

  it("lifts a linked content restriction atomically", async () => {
    const flagId = await createFlag();
    const decision = await service.decideFlag({
      flagId,
      moderatorId: moderatorId as never,
      action: "hide",
      reasonCode: "spam",
      reasonNote: "test",
      restriction: { type: "hidden", scope: "public", endsAt: null },
      idempotencyKey: `lift-decision-${randomUUID()}`,
    });
    expect(decision.restriction).not.toBeNull();

    await service.reverseDecision({
      decisionId: decision.decision.id,
      actorId: moderatorId as never,
      reason: "mistake",
      idempotencyKey: `lift-reversal-${randomUUID()}`,
    });

    const { rows } = await pool.query<{ lifted_at: Date | null }>("select lifted_at from content_restrictions where id = $1", [decision.restriction!.id]);
    expect(rows[0]!.lifted_at).not.toBeNull();
  });
});
