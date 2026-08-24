// Расширение каталога до глобального набора известных 3D-печать экосистем (MF-2039), по
// референс-списку из 3dmake (draft.plag.space/3dmake/ecosystems — независимый рыночный отчёт,
// 18 брендов, отранжированных по "силе экосистемы"). Три из восемнадцати (Creality/QIDI/
// Snapmaker) уже были в каталоге, заведены вручную в MF-2028 ДО этого скрипта — включены в
// список тоже (см. первые три записи ниже), чтобы website-бэкафилл (см. upsertVendor) подхватил
// и их — единый источник истины на все 18, не 15+3 раздельно.
//
// Данные — идентификация бренда+флагманской модели по общим знаниям (не live-scrape TDS-страниц,
// в отличие от import-ru-vendors-bootstrap.ts), поэтому честно: `source: 'community'`,
// `verified: false`, `specs: {}` — тот же уровень достоверности, что уже стоит у Creality K1/
// QIDI Q2/Snapmaker U1 (проверено запросом к БД перед написанием этого файла). Цель прогона — не
// точные спеки, а сам факт "бренд+флагман существуют в каталоге" → это триггерит
// ensureCatalogCommunity (community/catalogCommunity.ts, MF-2039) и заводит их сабы.
//
// Идемпотентен: vendors через `on conflict (slug) do nothing`, machines через `on conflict
// (vendor_id, model) do nothing` (нет такого constraint'а буквально — эмулируется select-перед-
// insert, см. upsertMachine). Безопасно перезапускать.
//
// Запуск: pnpm --filter @portal/api exec tsx scripts/import-global-printer-vendors-bootstrap.ts [--dry-run]
// env: DATABASE_URL (обяз., кроме --dry-run).

import { pool } from "../src/db/client.ts";
import { ensureCatalogCommunity } from "../src/modules/community/public/index.ts";
import { assertSafeBootstrapTarget } from "./dev-seed-guard.ts";

const DRY_RUN = process.argv.includes("--dry-run");

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

type MachineKind = "fdm_printer" | "sla_printer" | "cnc_router" | "cnc_lathe" | "laser_cutter";

interface VendorSeed {
  name: string;
  website: string;
  flagship: { model: string; kind: MachineKind };
}

// Флагман = самая узнаваемая актуальная модель бренда на момент написания (2026), не полный модельный
// ряд — тот же принцип "один SKU на бренд для старта", что уже применён к Creality K1/QIDI Q2/
// Snapmaker U1. kind ограничен доменной моделью (только fdm_printer/sla_printer в этом списке —
// ни один из 15 не CNC/лазер). website — официальный домен бренда, нужен только для favicon-иконки
// в сабах (vendors.website, migration 20260721170000) — не проверялся live-фетчем, если домен
// сменился, поправить здесь.
const VENDORS: VendorSeed[] = [
  // Три уже заведены вручную в MF-2028 (Creality/QIDI Tech/Snapmaker, до появления этого скрипта)
  // — здесь только затем, чтобы update-if-null ниже подхватил website задним числом. name/model
  // должны совпадать буквально с уже существующими строками (проверено запросом к БД), иначе
  // upsertVendor/upsertMachine создадут дубли вместо "exists".
  { name: "Creality", website: "creality.com", flagship: { model: "K1", kind: "fdm_printer" } },
  { name: "QIDI Tech", website: "qidi3d.com", flagship: { model: "Q2", kind: "fdm_printer" } },
  { name: "Snapmaker", website: "snapmaker.com", flagship: { model: "U1", kind: "fdm_printer" } },
  { name: "Bambu Lab", website: "bambulab.com", flagship: { model: "X1 Carbon", kind: "fdm_printer" } },
  { name: "Prusa Research", website: "prusa3d.com", flagship: { model: "MK4", kind: "fdm_printer" } },
  { name: "Stratasys", website: "stratasys.com", flagship: { model: "F370", kind: "fdm_printer" } },
  { name: "Anycubic", website: "anycubic.com", flagship: { model: "Kobra 3", kind: "fdm_printer" } },
  { name: "ELEGOO", website: "elegoo.com", flagship: { model: "Neptune 4 Pro", kind: "fdm_printer" } },
  { name: "Raise3D", website: "raise3d.com", flagship: { model: "Pro3", kind: "fdm_printer" } },
  { name: "3D Systems", website: "3dsystems.com", flagship: { model: "Figure 4 Standalone", kind: "sla_printer" } },
  { name: "Markforged", website: "markforged.com", flagship: { model: "X7", kind: "fdm_printer" } },
  { name: "Flashforge", website: "flashforge.com", flagship: { model: "Adventurer 5M Pro", kind: "fdm_printer" } },
  { name: "Formlabs", website: "formlabs.com", flagship: { model: "Form 4", kind: "sla_printer" } },
  { name: "UltiMaker", website: "ultimaker.com", flagship: { model: "S5", kind: "fdm_printer" } },
  { name: "Carbon", website: "carbon3d.com", flagship: { model: "M3", kind: "sla_printer" } },
  { name: "Zortrax", website: "zortrax.com", flagship: { model: "M300 Dual", kind: "fdm_printer" } },
  { name: "Phrozen", website: "phrozen3d.com", flagship: { model: "Sonic Mighty 8K", kind: "sla_printer" } },
  { name: "AnkerMake", website: "ankermake.com", flagship: { model: "M5C", kind: "fdm_printer" } },
];

async function upsertVendor(name: string, website: string): Promise<{ id: string; created: boolean }> {
  const slug = slugify(name);
  const existing = await pool.query<{ id: string }>(`select id from vendors where slug = $1`, [slug]);
  if (existing.rows[0]) {
    // Бэкафилл домена и для вендоров, заведённых ДО этого прогона (напр. Creality/QIDI/Snapmaker,
    // а также любые, которых entity-resolution пайплайн уже успел завести из slicer-профилей).
    await pool.query(`update vendors set website = $2 where id = $1 and website is null`, [existing.rows[0].id, website]);
    return { id: existing.rows[0].id, created: false };
  }
  const inserted = await pool.query<{ id: string }>(`insert into vendors (slug, name, website, verified) values ($1, $2, $3, false) returning id`, [slug, name, website]);
  return { id: inserted.rows[0]!.id, created: true };
}

async function upsertMachine(vendorId: string, model: string, kind: MachineKind): Promise<{ id: string; created: boolean }> {
  const existing = await pool.query<{ id: string }>(`select id from machines where vendor_id = $1 and model = $2`, [vendorId, model]);
  if (existing.rows[0]) return { id: existing.rows[0].id, created: false };
  const inserted = await pool.query<{ id: string }>(
    `insert into machines (craft, kind, vendor_id, model, specs, field_provenance, status, source, verified)
     values ('3d_printing', $1, $2, $3, '{}'::jsonb, '{}'::jsonb, 'active', 'community', false)
     returning id`,
    [kind, vendorId, model],
  );
  return { id: inserted.rows[0]!.id, created: true };
}

async function main(): Promise<void> {
  if (!DRY_RUN) await assertSafeBootstrapTarget(pool);
  let vendorsCreated = 0;
  let machinesCreated = 0;
  let communitiesEnsured = 0;

  for (const seed of VENDORS) {
    if (DRY_RUN) {
      console.log(`[dry-run] vendor=${seed.name} machine=${seed.flagship.model} (${seed.flagship.kind})`);
      continue;
    }

    const vendor = await upsertVendor(seed.name, seed.website);
    if (vendor.created) vendorsCreated += 1;
    await ensureCatalogCommunity("vendor", vendor.id, seed.name);
    communitiesEnsured += 1;

    const machine = await upsertMachine(vendor.id, seed.flagship.model, seed.flagship.kind);
    if (machine.created) machinesCreated += 1;
    await ensureCatalogCommunity("machine", machine.id, `${seed.name} ${seed.flagship.model}`);
    communitiesEnsured += 1;

    console.log(`${seed.name} → vendor ${vendor.created ? "created" : "exists"}, ` + `${seed.flagship.model} → machine ${machine.created ? "created" : "exists"}`);
  }

  if (!DRY_RUN) {
    console.log(`done: vendors_created=${vendorsCreated} machines_created=${machinesCreated} communities_ensured=${communitiesEnsured}`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => {
    if (!DRY_RUN) void pool.end();
  });
