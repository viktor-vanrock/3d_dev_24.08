// Прогон очереди импорт-джобов (MF-37/MF-417 шаг 2, MF-740). Берёт все queued/running джобы,
// расшифровывает credential их import_connections и строит ImportConnector фабрикой под
// source_platform (см. src/modules/imports/infrastructure/worker.ts::runImportJob) — коннектор одна на джоб/аккаунт-
// источник, не на вызов (MF-739). Прогоняет джоб до исчерпания item, готовых к обработке ПРЯМО
// СЕЙЧАС: свежие item и due-ретраи после бэкоффа; item с next_retry_at в будущем дождутся
// следующего прогона. Под расписание — Ops заводит cron/systemd timer поверх этого npm-скрипта
// (тот же приём, что ingest-run.ts).
//
// Запуск: pnpm --filter @portal/api run import:run
// env: DATABASE_URL, AUTH_ENCRYPTION_KEY (обяз., для расшифровки import_connections.credential_enc).

import { pool } from "../src/db/client.ts";
import { decryptIdentity } from "../src/modules/auth/public/index.ts";
import { createCults3dConnector, runImportJob, type ImportAuth, type ImportConnector } from "../src/modules/imports/public/operations.ts";

// connectionId передаётся фабрике явно (не только через auth) — коннектор сам маркирует
// ownership_status='verified' после первого успешного запроса (MF-37 § 6, карточка MF-742),
// для этого ему нужен id строки import_connections, а не только расшифрованный секрет.
type ConnectorFactory = (auth: ImportAuth, connectionId: string) => ImportConnector;

const CONNECTOR_FACTORIES: Partial<Record<string, ConnectorFactory>> = {
  cults3d: createCults3dConnector,
};

interface DueJob {
  id: string;
  source_platform: string;
  connection_id: string | null;
}

async function duePlatformJobs(): Promise<DueJob[]> {
  const result = await pool.query<DueJob>(`select id, source_platform, connection_id from import_jobs where status in ('queued', 'running') order by created_at`);
  return result.rows;
}

async function loadAuth(connectionId: string): Promise<ImportAuth> {
  const result = await pool.query<{ credential_enc: Buffer; external_username: string | null }>(`select credential_enc, external_username from import_connections where id = $1`, [
    connectionId,
  ]);
  const row = result.rows[0];
  if (!row) throw new Error(`import connection ${connectionId} not found`);
  const decrypted = decryptIdentity(row.credential_enc) as { api_key: string };
  return { username: row.external_username ?? "", apiKey: decrypted.api_key };
}

async function main(): Promise<void> {
  try {
    const jobs = await duePlatformJobs();
    for (const job of jobs) {
      const factory = CONNECTOR_FACTORIES[job.source_platform];
      if (!factory) {
        console.log(`пропускаю job ${job.id}: нет коннектора для ${job.source_platform}`);
        continue;
      }
      if (!job.connection_id) {
        console.log(`пропускаю job ${job.id}: нет привязанного import_connections`);
        continue;
      }
      const auth = await loadAuth(job.connection_id);
      const connector = factory(auth, job.connection_id);
      console.log(`→ job ${job.id} (${job.source_platform})`);
      await runImportJob(job.id, connector);
    }
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
