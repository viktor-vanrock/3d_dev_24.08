// MF-1952: точечно освежает фикстуры GET /me/printers/:id/live (device_state.updated_at) без
// полного pnpm seed:dev (который ещё читает/грузит 20 моделей + GLB/webp в S3 — секунды, когда
// нужно быстро вернуть "printing"/"paused"/"error" в окно DEVICE_STATE_STALE_AFTER_MS (45с)
// перед webcheck/curl-проверкой). Запуск: pnpm --filter @portal/api seed:dev:live-printers
import { pool } from "../src/db/client.ts";
import { assertSafeDevSeed } from "./dev-seed-guard.ts";
import { upsertDevLivePrinterFixtures } from "./seed-dev-live-printers.ts";

async function run(): Promise<void> {
  console.log("touch-dev-live-printers: старт");
  await assertSafeDevSeed(pool);
  const result = await upsertDevLivePrinterFixtures(pool);
  console.log(`touch-dev-live-printers: готово, owner_user_id=${result.ownerUserId}`);
  for (const [key, id] of Object.entries(result.printerIds)) {
    console.log(`  ${key.padEnd(20, " ")} ${id}`);
  }
}

run()
  .then(() => pool.end())
  .then(() => process.exit(0))
  .catch(async (err) => {
    console.error(err instanceof Error ? err.message : err);
    await pool.end().catch(() => {});
    process.exit(1);
  });
