import type { Pool, PoolClient, QueryResult, QueryResultRow } from "pg";
import { describe, expect, it, vi } from "vitest";
import { IdeaId, UserId } from "../../_kernel/brandedIds.ts";
import { IdeasRepository } from "./ideas.repository.ts";

function result(rows: QueryResultRow[], rowCount = rows.length): QueryResult<QueryResultRow> {
  return { rows, rowCount, command: "", oid: 0, fields: [] };
}

function repositoryWith(results: QueryResult<QueryResultRow>[]) {
  const query = vi.fn<(text: string, params?: readonly unknown[]) => Promise<QueryResult<QueryResultRow>>>(() => Promise.resolve(results.shift() ?? result([])));
  const release = vi.fn();
  const client = { query, release } as unknown as PoolClient;
  const pool = { connect: vi.fn(() => Promise.resolve(client)) } as unknown as Pool;
  return { repository: new IdeasRepository(pool), query, release };
}

describe("IdeasRepository transactions", () => {
  it("serializes create quota and commits the quota check plus insert atomically", async () => {
    const row = {
      id: "11111111-1111-4111-8111-111111111111",
      author_id: "22222222-2222-4222-8222-222222222222",
      title: "Title",
      body: "Body",
      category: "catalog",
      type: "idea",
      status: "proposed",
      canonical_id: null,
      vote_count: 0,
      decline_reason: null,
      origin: null,
      ai_assisted: false,
      created_at: new Date("2026-08-05T00:00:00Z"),
      last_activity_at: new Date("2026-08-05T00:00:00Z"),
    };
    const { repository, query, release } = repositoryWith([result([]), result([]), result([{ count: "1" }]), result([row]), result([])]);

    const created = await repository.createWithinQuota(UserId(row.author_id), {
      title: row.title,
      body: row.body,
      category: row.category,
      type: row.type,
      origin: null,
      aiAssisted: false,
    });

    expect(created).toMatchObject({ kind: "created", remaining: 1 });
    expect(query.mock.calls.map((call) => String(call[0]).trim().split(/\s+/).slice(0, 3).join(" "))).toEqual([
      "begin",
      "select pg_advisory_xact_lock($1, hashtext($2))",
      "select count(*) from",
      "insert into ideas",
      "commit",
    ]);
    expect(release).toHaveBeenCalledOnce();
  });

  it("rolls back instead of committing when the daily quota is exhausted", async () => {
    const { repository, query } = repositoryWith([result([]), result([]), result([{ count: "3" }]), result([])]);
    await expect(
      repository.createWithinQuota(UserId("22222222-2222-4222-8222-222222222222"), {
        title: "Title",
        body: "Body",
        category: "catalog",
        type: "idea",
        origin: null,
        aiAssisted: false,
      }),
    ).resolves.toEqual({ kind: "limited" });
    expect(query.mock.calls.at(-1)?.[0]).toBe("rollback");
  });

  it("keeps vote existence, toggle, audit log, recount, and denormalized update in one transaction", async () => {
    const { repository, query } = repositoryWith([
      result([]),
      result([{}]),
      result([{ idea_id: "11111111-1111-4111-8111-111111111111" }]),
      result([]),
      result([{ vote_count: "1" }]),
      result([]),
      result([]),
    ]);
    await expect(repository.toggleVote(UserId("22222222-2222-4222-8222-222222222222"), IdeaId("11111111-1111-4111-8111-111111111111"))).resolves.toEqual({
      exists: true,
      hasVoted: true,
      voteCount: 1,
    });
    const sql = query.mock.calls.map((call) => String(call[0]));
    expect(sql).toEqual(
      expect.arrayContaining([
        expect.stringContaining("for update"),
        expect.stringContaining("insert into idea_votes"),
        expect.stringContaining("insert into idea_vote_log"),
        expect.stringContaining("count(*)::int"),
        expect.stringContaining("update ideas set vote_count"),
        "commit",
      ]),
    );
  });
});
