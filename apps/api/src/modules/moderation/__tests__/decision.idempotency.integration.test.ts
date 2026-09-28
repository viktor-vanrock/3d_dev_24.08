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
let reporterId: string;
let moderatorId: string;

async function createUser(username: string): Promise<string> {
  return (await pool.query<{ id: string }>("insert into users (username) values ($1) returning id", [username])).rows[0]!.id;
}

async function createFlag(): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `insert into reports
       (subject_type, subject_id, reporter_id, reason_code, reason_text, subject_snapshot, priority, due_at, idempotency_key, status, created_at, updated_at)
     values ('post', $1, $2, 'spam', null, '{}'::jsonb, 20, now() + interval '1 hour', $3, 'open', now(), now())
     returning id`,
    [randomUUID(), reporterId, `idempotency-${randomUUID()}`],
  );
  const flagId = result.rows[0]!.id;
  flagIds.push(flagId);
  return flagId;
}

async function cleanup(): Promise<void> {
  const userIds = [reporterId, moderatorId].filter(Boolean);
  if (flagIds.length) {
    await pool.query("delete from moderation_decisions where flag_id = any($1::uuid[])", [flagIds]);
    await pool.query("delete from flag_claims where flag_id = any($1::uuid[])", [flagIds]);
    await pool.query("delete from content_restrictions where started_by = any($1::uuid[])", [userIds]);
    await pool.query("delete from reports where id = any($1::uuid[])", [flagIds.splice(0)]);
  }
}

describe.skipIf(!canRun)("Decision idempotency", () => {
  beforeAll(async () => {
    reporterId = await createUser(`idempotency-reporter-${randomUUID()}`);
    moderatorId = await createUser(`idempotency-moderator-${randomUUID()}`);
  });

  afterEach(cleanup);
  afterAll(async () => {
    await cleanup();
    await pool.end();
  });

  it("returns the same decision for an identical idempotency key", async () => {
    const flagId = await createFlag();
    const idempotencyKey = `same-${randomUUID()}`;
    const input = {
      flagId,
      moderatorId: moderatorId as never,
      action: "dismiss" as const,
      reasonCode: "spam" as const,
      reasonNote: null,
      idempotencyKey,
    };

    const first = await service.decideFlag(input);
    const second = await service.decideFlag(input);

    expect(second.decision.id).toBe(first.decision.id);
  });

  it("rejects a reused key with a different payload", async () => {
    const firstFlagId = await createFlag();
    const secondFlagId = await createFlag();
    const idempotencyKey = `conflict-${randomUUID()}`;
    await service.decideFlag({
      flagId: firstFlagId,
      moderatorId: moderatorId as never,
      action: "dismiss",
      reasonCode: "spam",
      reasonNote: null,
      idempotencyKey,
    });

    await expect(
      service.decideFlag({
        flagId: secondFlagId,
        moderatorId: moderatorId as never,
        action: "approve",
        reasonCode: "other",
        reasonNote: null,
        idempotencyKey,
      }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it("writes one audit event for idempotent retries", async () => {
    const flagId = await createFlag();
    const input = {
      flagId,
      moderatorId: moderatorId as never,
      action: "dismiss" as const,
      reasonCode: "spam" as const,
      reasonNote: null,
      idempotencyKey: `audit-${randomUUID()}`,
    };
    await service.decideFlag(input);
    await service.decideFlag(input);

    const { rows } = await pool.query<{ cnt: number }>(
      `select count(*)::int as cnt from audit_log
       where action = 'flag.decided' and target_type = 'flag' and target_id = $1::uuid`,
      [flagId],
    );
    expect(rows[0]!.cnt).toBe(1);
  });

  it("writes one content restriction for idempotent retries", async () => {
    const flagId = await createFlag();
    const input = {
      flagId,
      moderatorId: moderatorId as never,
      action: "hide" as const,
      reasonCode: "spam" as const,
      reasonNote: "test",
      restriction: { type: "hidden" as const, scope: "public" as const, endsAt: null },
      idempotencyKey: `restriction-${randomUUID()}`,
    };
    await service.decideFlag(input);
    await service.decideFlag(input);

    const { rows } = await pool.query<{ cnt: number }>(
      `select count(*)::int as cnt from content_restrictions
       where subject_id = (select subject_id from reports where id = $1)`,
      [flagId],
    );
    expect(rows[0]!.cnt).toBe(1);
  });
});
