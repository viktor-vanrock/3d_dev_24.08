// Прогон entity resolution пайплайна (MF-406, декомпозиция MF-648) — обёртка над
// runEntityResolution (src/modules/catalog/infrastructure/resolve/run.ts): blocking→matching→merge→plausibility
// поверх machine_candidates.status='pending'. Тот же паттерн, что scripts/ingest-run.ts —
// разовый ручной прогон сейчас, под расписание Ops заводит cron/systemd timer поверх этого
// npm-скрипта.
//
// Запуск:
//   pnpm --filter @portal/api run resolve:run
//   pnpm --filter @portal/api run resolve:run -- --limit 100
// env: DATABASE_URL (обяз.).

import { pool } from "../src/db/client.ts";
import { runEntityResolution } from "../src/modules/catalog/public/operations.ts";

const args = process.argv.slice(2);
function flagValue(name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}
const LIMIT = flagValue("--limit") ? Number(flagValue("--limit")) : undefined;

async function main(): Promise<void> {
  try {
    const result = await runEntityResolution({ limit: LIMIT });
    console.log(
      `processed=${result.processed} created=${result.createdMachines} merged_clean=${result.mergedClean}` +
        ` merged_with_conflicts=${result.mergedWithConflicts} ambiguous=${result.ambiguousMatches}` +
        ` quarantined=${result.quarantinedCandidates} invalid=${result.invalidCandidates}`,
    );
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
