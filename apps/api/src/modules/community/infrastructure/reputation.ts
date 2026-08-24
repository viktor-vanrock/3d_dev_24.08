import { pool } from "../../../db/client.ts";
import { getOwnedTrustState, incrementOwnedReputation, lockOwnedUser, setOwnedTrustLevel } from "../../profile/public/legacy.ts";

// Репутационное ядро (MF-604, MF-35 Фаза 1, docs/epics/community.foundation.md
// §«Репутационное ядро и trust-levels», Data-вердикт по reputation_events/votes от 2026-07-09).
// Community CRUD (создание threads/posts, сам эндпоинт голосования) — вне этой карточки, схема
// только что смержена и этого слоя ещё нет; функции ниже — точка, которую будущий
// POST /threads/:id/vote и POST /posts/:id/vote вызовут по образцу models/vote.ts, плюс
// принятие ответа. Здесь же они покрыты тестами напрямую (без HTTP), как detail.test.ts делает
// для моделей.

export const DAILY_CAP = 200;

const POINTS = {
  answerUpvoted: 10,
  postUpvoted: 5, // апвоут reply/comment — та же ставка, что апвоут вопроса
  questionUpvoted: 5,
  downvoted: -2,
  answerAccepted: 15,
} as const;

// v1-дефолты TL1..TL3 (Data-вердикт п.3 в доке: сигнала «прочитано» для TL1 в продукте нет,
// reputation_score — согласованный прокси до появления трекинга чтения; TL2/TL3 — окно
// активности «посты+апвоуты», механику/числа доке оставила на Back). Не схема — тюнится без
// миграции.
const TL1_REPUTATION_THRESHOLD = 5;
const TL2_WINDOW_DAYS = 30;
const TL2_ACTIVITY_THRESHOLD = 10;
const TL3_WINDOW_DAYS = 100;
const TL3_ACTIVITY_THRESHOLD = 50;

export type ReputationReason = "post_upvoted" | "question_upvoted" | "post_downvoted" | "answer_accepted" | "daily_cap_reached";

export type ReputationSubjectType = "post" | "thread";

export interface AwardResult {
  granted: number; // реально начислено; 0 при сработавшем дневном капе
  capped: boolean;
}

// Дневной кап проверяется только для положительных начислений — SUM(points) за сутки
// литерально по формуле дока (включая уже списанные даунвоуты, это не денормализованная
// колонка "очков за сегодня"). Check+award идут в одной транзакции с `select ... for update`
// на строке юзера — так конкурентные начисления одному юзеру сериализуются и не проходят кап
// гонкой (MF-675). Если оставшийся до капа остаток меньше points — начисление клампится до
// остатка (не all-or-nothing), событие логируется урезанным; капа = 0 очков логируется
// отдельным daily_cap_reached, как раньше.
async function awardReputation(userId: string, points: number, reason: ReputationReason, subjectType: ReputationSubjectType, subjectId: string): Promise<AwardResult> {
  const client = await pool.connect();
  let granted = points;
  let capped = false;
  try {
    await client.query("begin");
    await lockOwnedUser(client, userId);

    // Один ответ может быть принят повторно из-за ретрая HTTP-запроса. Проверка выполняется
    // внутри той же транзакции и под блокировкой пользователя; уникальный индекс в схеме —
    // второй, durable-предохранитель от повторного события.
    if (reason === "answer_accepted") {
      const existing = await client.query(
        `select 1 from reputation_events
         where user_id = $1 and reason = 'answer_accepted' and subject_type = $2 and subject_id = $3
         limit 1`,
        [userId, subjectType, subjectId],
      );
      if (existing.rowCount) {
        await client.query("commit");
        return { granted: 0, capped: false };
      }
    }

    if (points > 0) {
      const capRow = await client.query<{ total: string }>(
        `select coalesce(sum(points), 0) as total from reputation_events
         where user_id = $1 and created_at >= date_trunc('day', now())`,
        [userId],
      );
      const total = Number(capRow.rows[0]?.total ?? 0);
      const remaining = DAILY_CAP - total;

      if (remaining <= 0) {
        await client.query(
          `insert into reputation_events (user_id, points, reason, subject_type, subject_id)
           values ($1, 0, 'daily_cap_reached', $2, $3)`,
          [userId, subjectType, subjectId],
        );
        await client.query("commit");
        return { granted: 0, capped: true };
      }

      if (points > remaining) {
        granted = remaining;
        capped = true;
      }
    }

    const event = await client.query<{ points: number }>(
      `insert into reputation_events (user_id, points, reason, subject_type, subject_id)
       values ($1, $2, $3, $4, $5)
       returning points`,
      [userId, granted, reason, subjectType, subjectId],
    );
    granted = Number(event.rows[0]?.points ?? 0);
    await incrementOwnedReputation(client, userId, granted);
    await client.query("commit");
  } catch (err) {
    await client.query("rollback");
    throw err;
  } finally {
    client.release();
  }

  await recomputeTrustLevel(userId);
  return { granted, capped };
}

interface VotablePost {
  id: string;
  authorId: string;
  kind: "answer" | "reply" | "comment";
}

export async function awardPostVote(post: VotablePost, value: 1 | -1): Promise<AwardResult> {
  if (value === 1) {
    const points = post.kind === "answer" ? POINTS.answerUpvoted : POINTS.postUpvoted;
    return awardReputation(post.authorId, points, "post_upvoted", "post", post.id);
  }
  return awardReputation(post.authorId, POINTS.downvoted, "post_downvoted", "post", post.id);
}

interface VotableThread {
  id: string;
  authorId: string;
  type: "discussion" | "question";
}

// Голос за дискуссию (type='discussion') очков не даёт, и даунвоут треда — тоже: у
// reputation_events.reason нет ни 'discussion_upvoted', ни варианта для минуса треда, в доке
// эти комбинации не упомянуты (см. §«Репутационное ядро»). Только апвоут вопроса.
export async function awardThreadVote(thread: VotableThread, value: 1 | -1): Promise<AwardResult | null> {
  if (thread.type !== "question" || value !== 1) return null;
  return awardReputation(thread.authorId, POINTS.questionUpvoted, "question_upvoted", "thread", thread.id);
}

export async function awardAcceptedAnswer(post: { id: string; authorId: string }): Promise<AwardResult> {
  return awardReputation(post.authorId, POINTS.answerAccepted, "answer_accepted", "post", post.id);
}

// TL4 и любой ручной оверрайд (trust_level_manual=true) — движок не трогает (schema guard,
// docs/epics/community.foundation.md). Иначе TL0..TL3 пересчитывается on-write, после каждого
// начисления — дешевле cron на объёмах Фазы 1, тот же принцип «агрегат запросом», что у
// «Статистика владения» в domain.model.md.
export async function recomputeTrustLevel(userId: string): Promise<number> {
  const user = await getOwnedTrustState(userId);
  if (!user || user.trust_level_manual) return user?.trust_level ?? 0;

  let level = user.reputation_score >= TL1_REPUTATION_THRESHOLD ? 1 : 0;

  if (level >= 1) {
    const tl2Activity = await windowActivity(userId, TL2_WINDOW_DAYS);
    if (tl2Activity >= TL2_ACTIVITY_THRESHOLD) {
      level = 2;
      const tl3Activity = await windowActivity(userId, TL3_WINDOW_DAYS);
      if (tl3Activity >= TL3_ACTIVITY_THRESHOLD) level = 3;
    }
  }

  if (level !== user.trust_level) {
    await setOwnedTrustLevel(userId, level);
  }
  return level;
}

// «Посты+апвоуты за последние N дней»: треды+посты, созданные юзером, плюс положительные
// reputation_events, полученные им (голоса/принятый ответ) — в окне. Агрегат запросом, не
// денормализованная стата.
async function windowActivity(userId: string, windowDays: number): Promise<number> {
  const result = await pool.query<{ count: string }>(
    `select
       (select count(*) from threads where author_id = $1 and created_at >= now() - ($2 || ' days')::interval)
       + (select count(*) from posts where author_id = $1 and created_at >= now() - ($2 || ' days')::interval)
       + (select count(*) from reputation_events
            where user_id = $1 and points > 0 and created_at >= now() - ($2 || ' days')::interval)
       as count`,
    [userId, windowDays],
  );
  return Number(result.rows[0]?.count ?? 0);
}
