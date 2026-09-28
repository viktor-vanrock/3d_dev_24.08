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
let moderatorOneId: string;
let moderatorTwoId: string;

async function createUser(username: string): Promise<string> {
  return (await pool.query<{ id: string }>("insert into users (username) values ($1) returning id", [username])).rows[0]!.id;
}

async function createFlag(): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `insert into reports
       (subject_type, subject_id, reporter_id, reason_code, reason_text, subject_snapshot, priority, due_at, idempotency_key, status, created_at, updated_at)
     values ('post', $1, $2, 'spam', null, '{}'::jsonb, 20, now() + interval '1 hour', $3, 'open', now(), now())
     returning id`,
    [randomUUID(), reporterId, `concurrency-${randomUUID()}`],
  );
  const flagId = result.rows[0]!.id;
  flagIds.push(flagId);
  return flagId;
}

async function cleanup(): Promise<void> {
  if (flagIds.length) {
    await pool.query("delete from moderation_decisions where flag_id = any($1::uuid[])", [flagIds]);
    await pool.query("delete from flag_claims where flag_id = any($1::uuid[])", [flagIds]);
    await pool.query("delete from reports where id = any($1::uuid[])", [flagIds.splice(0)]);
  }
}

describe.skipIf(!canRun)("Moderation decision concurrency", () => {
  beforeAll(async () => {
    reporterId = await createUser(`concurrency-reporter-${randomUUID()}`);
    moderatorOneId = await createUser(`concurrency-mod-1-${randomUUID()}`);
    moderatorTwoId = await createUser(`concurrency-mod-2-${randomUUID()}`);
  });

  afterEach(cleanup);
  afterAll(async () => {
    await cleanup();
    await pool.end();
  });

  it("concurrent claims have exactly one winner", async () => {
    const flagId = await createFlag();
    const [first, second] = await Promise.allSettled([
      service.claimFlag({ flagId, moderatorId: moderatorOneId as never, idempotencyKey: `claim-1-${randomUUID()}` }),
      service.claimFlag({ flagId, moderatorId: moderatorTwoId as never, idempotencyKey: `claim-2-${randomUUID()}` }),
    ]);

    const results = [first, second];
    const wins = results.filter((result) => result.status === "fulfilled");
    const losses = results.filter((result) => result.status === "rejected");
    expect(wins).toHaveLength(1);
    expect(losses).toHaveLength(1);
    if (losses[0]?.status !== "rejected") throw new Error("expected one rejected claim");
    expect(losses[0].reason?.status ?? losses[0].reason?.statusCode).toBe(409);
  });

  it("replaces an expired claim", async () => {
    const flagId = await createFlag();
    await pool.query(
      `insert into flag_claims (flag_id, moderator_id, claimed_at, expires_at, state)
       values ($1, $2, now() - interval '31 minutes', now() - interval '1 minute', 'active')`,
      [flagId, moderatorOneId],
    );

    const result = await service.claimFlag({
      flagId,
      moderatorId: moderatorTwoId as never,
      idempotencyKey: `expired-${randomUUID()}`,
    });

    expect(result.claim.moderatorId).toBe(moderatorTwoId);
  });

  it("prevents another moderator from releasing a claim", async () => {
    const flagId = await createFlag();
    await service.claimFlag({
      flagId,
      moderatorId: moderatorOneId as never,
      idempotencyKey: `owner-${randomUUID()}`,
    });

    await expect(service.releaseFlag({ flagId, moderatorId: moderatorTwoId as never })).rejects.toMatchObject({ status: 403 });
  });
});
