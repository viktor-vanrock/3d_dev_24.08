import { pool } from "../db/client.ts";

// MF-1892: тесты пишут реальные строки (users/models/community и т.д.) через прямые
// insert (см. import/ownership.test.ts::createUser) — если DATABASE_URL по ошибке
// смотрит на общую dev-БД, эти строки утекают на dev.3mf.tech вживую (видно в каталоге/
// на форуме как `ownership-test-<epoch>-...`). Денилист — второй замок к CI, где
// DATABASE_URL всегда указывает на эфемерный portal_test (.gitverse/workflows/ci.yaml).
const SHARED_DB_DENYLIST = new Set(["portal", "portal_dev"]);

export default async function dbSafetyGuard(): Promise<void> {
  if (!process.env.DATABASE_URL) return;

  const { rows } = await pool.query<{ db: string }>("select current_database() as db");
  const db = rows[0]?.db;

  if (db && SHARED_DB_DENYLIST.has(db)) {
    await pool.end();
    throw new Error(
      `dbSafetyGuard: DATABASE_URL указывает на общую БД '${db}' — тесты сюда писать нельзя ` +
        `(MF-1892: утечка тестовых фикстур на dev.3mf.tech). Гоняй тесты против эфемерной БД ` +
        `(CI: portal_test, локально: sandbox-db create sbx_<имя> --from portal_dev, см. docs/process/testing.md).`,
    );
  }
}
