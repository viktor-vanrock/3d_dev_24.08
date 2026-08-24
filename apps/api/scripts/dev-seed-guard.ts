import type { Pool } from "pg";

type DatabaseTarget = Pick<Pool, "query">;

const PROTECTED_DATABASES = new Set(["portal", "postgres", "template0", "template1"]);

async function currentDatabase(pool: DatabaseTarget): Promise<string> {
  const { rows } = await pool.query<{ db: string }>("select current_database() as db");
  const name = rows[0]?.db;
  if (!name) throw new Error("operational target guard: current_database() returned no database name");
  return name;
}

export async function assertSafeBootstrapTarget(pool: DatabaseTarget, env: NodeJS.ProcessEnv = process.env): Promise<void> {
  if (env.NODE_ENV === "production") throw new Error("bootstrap: NODE_ENV=production — mutation rejected");
  if (!env.DATABASE_URL) throw new Error("bootstrap: DATABASE_URL не задан");

  const expected = env.BOOTSTRAP_DB_NAME ?? "portal_dev";
  const actual = await currentDatabase(pool);
  if (PROTECTED_DATABASES.has(actual)) throw new Error(`bootstrap: protected database '${actual}' — mutation rejected`);
  if (actual !== expected) throw new Error(`bootstrap: connected database '${actual}', expected BOOTSTRAP_DB_NAME='${expected}'`);
}

export async function assertExplicitOperationalTarget(pool: DatabaseTarget, operation: string, confirmationVariable: string, env: NodeJS.ProcessEnv = process.env): Promise<void> {
  if (!env.DATABASE_URL) throw new Error(`${operation}: DATABASE_URL не задан`);
  const expected = env[confirmationVariable]?.trim();
  if (!expected) throw new Error(`${operation}: ${confirmationVariable} must explicitly name the target database`);
  const actual = await currentDatabase(pool);
  if (actual !== expected) throw new Error(`${operation}: connected database '${actual}' does not match ${confirmationVariable}='${expected}'`);
}

// Общий предохранитель для dev-only сид/тач-скриптов (изначально seed-dev.ts, MF-535; вынесен
// сюда в MF-1952, чтобы touch-dev-live-printers.ts не носил свою копию — одна проверка, не две
// расходящиеся). Прод живёт в БД `portal` (CLAUDE.md) — гейт отсекает его физически, не только
// через NODE_ENV.
export async function assertSafeDevSeed(pool: DatabaseTarget, env: NodeJS.ProcessEnv = process.env): Promise<void> {
  if (env.NODE_ENV === "production") {
    throw new Error("dev-seed: NODE_ENV=production — отказ (сид только для dev-среды)");
  }
  if (!env.DATABASE_URL) {
    throw new Error("dev-seed: DATABASE_URL не задан");
  }
  const expected = env.SEED_DB_NAME ?? "portal_dev";
  const db = await currentDatabase(pool);
  // Жёсткий денилист: прод-БД называется 'portal' — её нельзя сидить НИКОГДА, даже если
  // SEED_DB_NAME=portal передан по ошибке. Второй замок к NODE_ENV-гейту.
  if (db === "portal") {
    throw new Error("dev-seed: подключена прод-БД 'portal' — отказ безусловно (сид только для dev)");
  }
  if (db !== expected) {
    throw new Error(`dev-seed: подключена БД '${db}', ожидается '${expected}' — отказ (прод живёт в 'portal')`);
  }
  console.log(`  гейт пройден: NODE_ENV=${env.NODE_ENV ?? "(unset)"}, db='${db}'`);
}
