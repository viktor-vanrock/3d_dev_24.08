import { afterEach, describe, expect, it } from "vitest";
import { pool } from "../../../db/client.ts";
import { DAILY_CAP, awardAcceptedAnswer, awardPostVote, awardThreadVote, recomputeTrustLevel } from "./reputation.ts";

interface Fixture {
  userId: string;
  communityId: string;
  threadId: string;
  postId: string;
}

const cleanupFixtures: Fixture[] = [];

afterEach(async () => {
  while (cleanupFixtures.length) {
    const fixture = cleanupFixtures.pop()!;
    // threads/posts.author_id → users(id) без cascade — сносим community (каскадом уносит
    // threads/posts/votes/reputation_events по subject не завязаны, но у reputation_events
    // user_id cascade есть) прежде user.
    await pool.query(`delete from communities where id = $1`, [fixture.communityId]);
    await pool.query(`delete from users where id = $1`, [fixture.userId]);
  }
});

async function makeFixture(threadType: "discussion" | "question" = "question"): Promise<Fixture> {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const userResult = await pool.query<{ id: string }>(`insert into users (username) values ($1) returning id`, [`rep-${suffix}`]);
  const userId = userResult.rows[0]!.id;

  const communityResult = await pool.query<{ id: string }>(`insert into communities (slug, name) values ($1, 'Test community') returning id`, [`community-${suffix}`]);
  const communityId = communityResult.rows[0]!.id;

  const threadResult = await pool.query<{ id: string }>(`insert into threads (community_id, author_id, type, title, content) values ($1, $2, $3, 'Title', 'Body') returning id`, [
    communityId,
    userId,
    threadType,
  ]);
  const threadId = threadResult.rows[0]!.id;

  const postResult = await pool.query<{ id: string }>(`insert into posts (thread_id, author_id, kind, content) values ($1, $2, 'answer', 'Answer body') returning id`, [
    threadId,
    userId,
  ]);
  const postId = postResult.rows[0]!.id;

  const fixture = { userId, communityId, threadId, postId };
  cleanupFixtures.push(fixture);
  return fixture;
}

async function reputationScore(userId: string): Promise<number> {
  const result = await pool.query<{ reputation_score: number }>(`select reputation_score from users where id = $1`, [userId]);
  return result.rows[0]!.reputation_score;
}

async function trustLevel(userId: string): Promise<number> {
  const result = await pool.query<{ trust_level: number }>(`select trust_level from users where id = $1`, [userId]);
  return result.rows[0]!.trust_level;
}

describe("awardPostVote", () => {
  it("grants +10 for an upvoted answer and logs a post_upvoted event", async () => {
    const fixture = await makeFixture();
    const result = await awardPostVote({ id: fixture.postId, authorId: fixture.userId, kind: "answer" }, 1);

    expect(result).toEqual({ granted: 10, capped: false });
    expect(await reputationScore(fixture.userId)).toBe(10);

    const events = await pool.query(`select reason, points, subject_type, subject_id from reputation_events where user_id = $1`, [fixture.userId]);
    expect(events.rows).toEqual([{ reason: "post_upvoted", points: 10, subject_type: "post", subject_id: fixture.postId }]);
  });

  it("grants +5 for an upvoted reply/comment", async () => {
    const fixture = await makeFixture();
    const result = await awardPostVote({ id: fixture.postId, authorId: fixture.userId, kind: "reply" }, 1);
    expect(result).toEqual({ granted: 5, capped: false });
    expect(await reputationScore(fixture.userId)).toBe(5);
  });

  it("applies -2 to the author on downvote", async () => {
    const fixture = await makeFixture();
    const result = await awardPostVote({ id: fixture.postId, authorId: fixture.userId, kind: "answer" }, -1);
    expect(result).toEqual({ granted: -2, capped: false });
    expect(await reputationScore(fixture.userId)).toBe(-2);
  });
});

describe("awardThreadVote", () => {
  it("grants +5 for an upvoted question", async () => {
    const fixture = await makeFixture("question");
    const result = await awardThreadVote({ id: fixture.threadId, authorId: fixture.userId, type: "question" }, 1);
    expect(result).toEqual({ granted: 5, capped: false });
    expect(await reputationScore(fixture.userId)).toBe(5);
  });

  it("does not award reputation for a discussion vote", async () => {
    const fixture = await makeFixture("discussion");
    const result = await awardThreadVote({ id: fixture.threadId, authorId: fixture.userId, type: "discussion" }, 1);
    expect(result).toBeNull();
    expect(await reputationScore(fixture.userId)).toBe(0);
  });

  it("does not award reputation for a question downvote", async () => {
    const fixture = await makeFixture("question");
    const result = await awardThreadVote({ id: fixture.threadId, authorId: fixture.userId, type: "question" }, -1);
    expect(result).toBeNull();
    expect(await reputationScore(fixture.userId)).toBe(0);
  });
});

describe("awardAcceptedAnswer", () => {
  it("grants +15 to the answer author", async () => {
    const fixture = await makeFixture();
    const result = await awardAcceptedAnswer({ id: fixture.postId, authorId: fixture.userId });
    expect(result).toEqual({ granted: 15, capped: false });
    expect(await reputationScore(fixture.userId)).toBe(15);

    const events = await pool.query(`select reason from reputation_events where user_id = $1`, [fixture.userId]);
    expect(events.rows).toEqual([{ reason: "answer_accepted" }]);
  });
});

describe("daily cap", () => {
  it("stops awarding once the daily cap is reached, logging a zero-point daily_cap_reached event", async () => {
    const fixture = await makeFixture();

    // 20 апвоутов ответа по +10 = ровно DAILY_CAP (200); 21-й должен упереться в кап.
    const votesToFillCap = DAILY_CAP / 10;
    for (let i = 0; i < votesToFillCap; i++) {
      const result = await awardPostVote({ id: fixture.postId, authorId: fixture.userId, kind: "answer" }, 1);
      expect(result.capped).toBe(false);
    }
    expect(await reputationScore(fixture.userId)).toBe(DAILY_CAP);

    const cappedResult = await awardPostVote({ id: fixture.postId, authorId: fixture.userId, kind: "answer" }, 1);
    expect(cappedResult).toEqual({ granted: 0, capped: true });
    // Кап не даёт очков сверху — счёт юзера не меняется.
    expect(await reputationScore(fixture.userId)).toBe(DAILY_CAP);

    const cappedEvent = await pool.query<{ reason: string; points: number }>(`select reason, points from reputation_events where user_id = $1 order by created_at desc limit 1`, [
      fixture.userId,
    ]);
    expect(cappedEvent.rows[0]).toEqual({ reason: "daily_cap_reached", points: 0 });
  });

  it("clamps to the remaining cap instead of all-or-nothing", async () => {
    const fixture = await makeFixture();
    // 19 апвоутов по +10 = 190; следующий +10 должен клампнуться до +10... поэтому берём
    // явный остаток в 5: 19*10=190, затем апвоут вопроса +5 доводит ровно до 195, затем
    // апвоут ответа +10 должен клампнуться до +5 (остаток), а не пройти all-or-nothing.
    for (let i = 0; i < 19; i++) {
      await awardPostVote({ id: fixture.postId, authorId: fixture.userId, kind: "answer" }, 1);
    }
    await awardThreadVote({ id: fixture.threadId, authorId: fixture.userId, type: "question" }, 1); // +5 → 195
    expect(await reputationScore(fixture.userId)).toBe(195);

    const clampedResult = await awardPostVote({ id: fixture.postId, authorId: fixture.userId, kind: "answer" }, 1);
    expect(clampedResult).toEqual({ granted: 5, capped: true });
    expect(await reputationScore(fixture.userId)).toBe(DAILY_CAP);

    const lastEvent = await pool.query<{ reason: string; points: number }>(`select reason, points from reputation_events where user_id = $1 order by created_at desc limit 1`, [
      fixture.userId,
    ]);
    expect(lastEvent.rows[0]).toEqual({ reason: "post_upvoted", points: 5 });
  });

  it("serializes concurrent awards for the same user so the cap cannot be overshot by a race", async () => {
    const fixture = await makeFixture();
    // 19 апвоутов по +10 = 190, остаток до капа — 10. Два параллельных апвоута ответа
    // (+10 каждый) не должны оба пройти полностью — без лока строки оба читают total=190
    // до коммита друг друга и оба проходят капа.
    for (let i = 0; i < 19; i++) {
      await awardPostVote({ id: fixture.postId, authorId: fixture.userId, kind: "answer" }, 1);
    }
    expect(await reputationScore(fixture.userId)).toBe(190);

    const [first, second] = await Promise.all([
      awardPostVote({ id: fixture.postId, authorId: fixture.userId, kind: "answer" }, 1),
      awardPostVote({ id: fixture.postId, authorId: fixture.userId, kind: "answer" }, 1),
    ]);

    expect(await reputationScore(fixture.userId)).toBe(DAILY_CAP);
    expect(first.granted + second.granted).toBe(10);
  });

  it("does not cap downvotes", async () => {
    const fixture = await makeFixture();
    for (let i = 0; i < DAILY_CAP / 10; i++) {
      await awardPostVote({ id: fixture.postId, authorId: fixture.userId, kind: "answer" }, 1);
    }
    expect(await reputationScore(fixture.userId)).toBe(DAILY_CAP);

    const result = await awardPostVote({ id: fixture.postId, authorId: fixture.userId, kind: "answer" }, -1);
    expect(result).toEqual({ granted: -2, capped: false });
    expect(await reputationScore(fixture.userId)).toBe(DAILY_CAP - 2);
  });
});

describe("trust levels", () => {
  it("stays TL0 below the TL1 reputation threshold", async () => {
    const fixture = await makeFixture();
    await awardPostVote({ id: fixture.postId, authorId: fixture.userId, kind: "reply" }, 1); // +5 (== threshold: reaches TL1 already)
    // reset back below threshold to check TL0 explicitly
    await pool.query(`update users set reputation_score = 0, trust_level = 0 where id = $1`, [fixture.userId]);
    expect(await recomputeTrustLevel(fixture.userId)).toBe(0);
  });

  it("promotes to TL1 once reputation_score crosses the threshold", async () => {
    const fixture = await makeFixture();
    await awardPostVote({ id: fixture.postId, authorId: fixture.userId, kind: "answer" }, 1); // +10
    expect(await trustLevel(fixture.userId)).toBe(1);
  });

  it("never auto-changes trust_level when trust_level_manual is set", async () => {
    const fixture = await makeFixture();
    await pool.query(`update users set trust_level = 4, trust_level_manual = true where id = $1`, [fixture.userId]);
    await awardPostVote({ id: fixture.postId, authorId: fixture.userId, kind: "answer" }, 1);
    expect(await trustLevel(fixture.userId)).toBe(4);
  });
});
