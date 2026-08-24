import type { PoolClient } from "pg";
import { pool } from "../../../db/client.ts";
import { bestScore, controversialScore, hotScore } from "../domain/ranking.ts";

// Материализация post_score (MF-420, Фаза 1 эпика MF-38, карточка п.3 «Поднять фоновый воркер
// пересчёта скоров и материализацию»). НЕ вызывается из API-хендлеров — только отсюда, из
// scripts/feed-score-worker.ts. Разделение на «событие голоса» и «батч» — общий канал
// pg LISTEN/NOTIFY (см. notifyPostScoreRecompute ниже), не отдельная таблица-очередь: голос —
// это единственное событие, которое двигает Hot/Best/Controversial раньше следующего батча, а
// NOTIFY — самый дешёвый способ разбудить воркер без лишней записи и индекса под неё. LISTEN не
// переживает рестарт воркера (payload не durable) — батч (batchRecomputeVisible) страхует
// пропущенные NOTIFY, пересчитывая ВСЮ активную выборку по расписанию (карточка явно требует
// именно это для time-decay Hot, не только on-event).
const RECOMPUTE_CHANNEL = "post_score_recompute";

interface PostRow {
  // numeric(10,3) — pg отдаёт строкой, не парсит в number сама.
  votes_up_weighted: string;
  votes_down_weighted: string;
  created_at: Date;
}

type ScoreDatabase = Pick<PoolClient, "query">;

// Вызывается будущим POST /feed/posts/:id/vote (Фаза 2, MF-421) сразу после записи голоса —
// один дешёвый round-trip, не блокирует ответ хендлера на сам пересчёт (пересчёт делает воркер,
// получив уведомление). pg_notify — не транзакционный побочный эффект (доставляется только при
// COMMIT), безопасно звать внутри той же транзакции, что и insert/update в votes.
export async function notifyPostScoreRecompute(postId: string, client: Pick<PoolClient, "query"> = pool): Promise<void> {
  await client.query(`select pg_notify($1, $2)`, [RECOMPUTE_CHANNEL, postId]);
}

export function recomputeChannel(): string {
  return RECOMPUTE_CHANNEL;
}

// Пересчёт одного поста: читает текущие votes_up_weighted/votes_down_weighted/created_at из
// feed_posts, прогоняет через чистые функции ranking.ts, апсертит в post_score. Trust-вес
// (MF-1859) влияет только здесь — на материализованные Hot/Best/Controversial, сырые votes_up/
// votes_down (list.ts sort=top, comments.ts best уже переключён отдельно) не читаются этой
// функцией вовсе. Скрытый/удалённый/несуществующий пост — строка скора убирается (лента не
// должна ранжировать то, что не видно).
export async function recomputePostScore(postId: string, database: ScoreDatabase = pool): Promise<void> {
  const result = await database.query<PostRow>(`select votes_up_weighted, votes_down_weighted, created_at from feed_posts where id = $1 and status = 'visible'`, [postId]);
  const post = result.rows[0];
  if (!post) {
    await database.query(`delete from post_score where post_id = $1`, [postId]);
    return;
  }

  const votesUpWeighted = Number(post.votes_up_weighted);
  const votesDownWeighted = Number(post.votes_down_weighted);
  const hot = hotScore(votesUpWeighted, votesDownWeighted, post.created_at);
  const best = bestScore(votesUpWeighted, votesDownWeighted);
  const controversial = controversialScore(votesUpWeighted, votesDownWeighted);

  await database.query(
    `insert into post_score (post_id, hot, best, controversial, computed_at)
     values ($1, $2, $3, $4, now())
     on conflict (post_id) do update set
       hot = excluded.hot, best = excluded.best, controversial = excluded.controversial, computed_at = excluded.computed_at`,
    [postId, hot, best, controversial],
  );
}

const BATCH_SIZE = 500;

// Батч-пересчёт всей активной выборки (карточка п.3: «батч-джоб пересчитывает Hot по всей
// активной выборке без блокировки API») — двигает временной член Hot вперёд даже для постов без
// новых голосов (time-decay). Постранично (BATCH_SIZE), не одним запросом на всю таблицу — на
// росте ленты не держит один гигантский оператор дольше необходимого и не блокирует параллельные
// recomputePostScore() по отдельным постам (каждая страница — свой короткий проход, не общая
// транзакция). Возвращает число пересчитанных постов — вызывающий скрипт логирует его.
export async function batchRecomputeVisible(
  database: ScoreDatabase = pool,
  recompute: (postId: string, database: ScoreDatabase) => Promise<void> = recomputePostScore,
): Promise<number> {
  let processed = 0;
  let lastId: string | null = null;

  for (;;) {
    const page: { rows: { id: string }[] } = lastId
      ? await database.query<{ id: string }>(`select id from feed_posts where status = 'visible' and id > $1 order by id limit $2`, [lastId, BATCH_SIZE])
      : await database.query<{ id: string }>(`select id from feed_posts where status = 'visible' order by id limit $1`, [BATCH_SIZE]);
    if (page.rows.length === 0) break;

    for (const row of page.rows) {
      await recompute(row.id, database);
      processed += 1;
    }

    lastId = page.rows[page.rows.length - 1]!.id;
    if (page.rows.length < BATCH_SIZE) break;
  }

  return processed;
}
