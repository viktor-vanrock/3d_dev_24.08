// Фоновый воркер пересчёта post_score (MF-420, Фаза 1 эпика MF-38, карточка п.3) — долгоживущий
// процесс, НЕ HTTP-хендлер apps/api. Ops заводит поверх него systemd-сервис (не timer — процесс
// держит открытым LISTEN-соединение постоянно). Для feed worker unit не хранится в этом
// репозитории; installed supervisor state must be inventoried by Ops before deployment changes.
//
// Два канала пересчёта в одном процессе:
//   1. LISTEN post_score_recompute — почти мгновенная реакция на голос (Фаза 2 хендлер вызывает
//      notifyPostScoreRecompute() сразу после записи голоса,
//      apps/api/src/modules/feed/infrastructure/scores.ts).
//   2. Периодический батч (BATCH_INTERVAL_MS) — пересчитывает ВСЮ видимую выборку, двигает
//      временной член Hot вперёд даже без новых голосов (time-decay) и подчищает пропущенные
//      NOTIFY (payload LISTEN не переживает рестарт воркера — батч самокорректируется).
//
// Запуск: pnpm --filter @portal/api run feed:score-worker
// env: DATABASE_URL (обяз.), FEED_SCORE_BATCH_INTERVAL_MS (опц., по умолчанию 5 минут).

import { Client, type Notification } from "pg";
import { pathToFileURL } from "node:url";
import { batchRecomputeVisible, recomputeChannel, recomputePostScore } from "../src/modules/feed/public/operations.ts";

const BATCH_INTERVAL_MS = process.env.FEED_SCORE_BATCH_INTERVAL_MS ? Number(process.env.FEED_SCORE_BATCH_INTERVAL_MS) : 5 * 60 * 1000;

interface ScoreWorkerClient {
  connect(): Promise<unknown>;
  query(sql: string): Promise<unknown>;
  end(): Promise<void>;
  on(event: "notification", listener: (message: Notification) => void): this;
  on(event: "error", listener: (error: Error) => void): this;
}

export interface ScoreWorkerDependencies {
  readonly client: ScoreWorkerClient;
  readonly batchIntervalMs: number;
  readonly batch: () => Promise<number>;
  readonly recompute: (postId: string) => Promise<void>;
  readonly channel: string;
  readonly setInterval: (callback: () => void, delay: number) => ReturnType<typeof setInterval>;
  readonly clearInterval: (interval: ReturnType<typeof setInterval>) => void;
  readonly fatal: (error: Error) => void;
}

export interface RunningScoreWorker {
  shutdown(): Promise<void>;
}

export async function startFeedScoreWorker(dependencies: ScoreWorkerDependencies): Promise<RunningScoreWorker> {
  const { client } = dependencies;
  if (!Number.isFinite(dependencies.batchIntervalMs) || dependencies.batchIntervalMs <= 0) {
    throw new Error("FEED_SCORE_BATCH_INTERVAL_MS must be a positive finite number");
  }
  await client.connect();

  client.on("notification", (msg) => {
    if (msg.channel !== dependencies.channel || !msg.payload) return;
    const postId = msg.payload;
    dependencies.recompute(postId).catch((err: unknown) => {
      console.error(`feed-score-worker: recompute failed for post ${postId}`, err);
    });
  });

  const state: { interval?: ReturnType<typeof setInterval> } = {};
  let stopped = false;
  const stop = async (): Promise<void> => {
    if (stopped) return;
    stopped = true;
    if (state.interval !== undefined) dependencies.clearInterval(state.interval);
    await client.end();
  };

  client.on("error", (err) => {
    // Соединение LISTEN — единственное на процесс; обрыв без падения процесса означал бы тихую
    // остановку near-real-time канала при живом батче — лучше упасть и дать supervisor (systemd)
    // перезапустить с чистым LISTEN, чем работать наполовину незаметно.
    console.error("feed-score-worker: LISTEN connection error, exiting for supervisor restart", err);
    void stop()
      .catch((shutdownError: unknown) => console.error("feed-score-worker: failed to close broken connection", shutdownError))
      .finally(() => dependencies.fatal(err));
  });

  await client.query(`listen ${dependencies.channel}`);
  console.log(`feed-score-worker: listening on "${dependencies.channel}", batch every ${dependencies.batchIntervalMs}ms`);

  const runBatch = async (): Promise<void> => {
    try {
      const count = await dependencies.batch();
      console.log(`feed-score-worker: batch recomputed ${count} post(s)`);
    } catch (err) {
      console.error("feed-score-worker: batch recompute failed", err);
    }
  };

  await runBatch();
  state.interval = dependencies.setInterval(() => {
    void runBatch();
  }, dependencies.batchIntervalMs);

  return { shutdown: stop };
}

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
  const worker = await startFeedScoreWorker({
    client: new Client({ connectionString: process.env.DATABASE_URL }),
    batchIntervalMs: BATCH_INTERVAL_MS,
    batch: batchRecomputeVisible,
    recompute: recomputePostScore,
    channel: recomputeChannel(),
    setInterval,
    clearInterval,
    fatal: () => {
      process.exitCode = 1;
    },
  });
  const shutdown = (): void => {
    void worker.shutdown().then(
      () => {
        process.exitCode = 0;
      },
      (error: unknown) => {
        console.error("feed-score-worker: shutdown failed", error);
        process.exitCode = 1;
      },
    );
  };
  process.on("SIGINT", () => {
    shutdown();
  });
  process.on("SIGTERM", () => {
    shutdown();
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err: unknown) => {
    console.error(err);
    process.exitCode = 1;
  });
}
