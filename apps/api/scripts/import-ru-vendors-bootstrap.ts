// RU-слой bootstrap-импорта (MF-409, Фаза 2 эпика MF-33 § «Импортёр v0»): ни SpoolmanDB, ни
// Open Filament Database не содержат ни одного RU-бренда (проверено вручную по дампам обоих
// источников 2026-07-10 — REC/PICASO 3D/Bestfilament/Filamentarno!/FDplast отсутствуют), это
// прямо предвидено описанием эпика («RU-специфика — нет готовой БД!»). В отличие от
// `import-materials-bootstrap.ts`/`import-machines-bootstrap.ts` (структурные JSON-источники,
// живой fetch на каждый прогон), здесь источник — вручную сверенные данные с офсайтов/TDS-вики
// брендов, зафиксированные КАК ЕСТЬ в этом файле (не live-скрейпинг). Полноценные автономные
// агенты-парсеры под RU-бренды — ОТДЕЛЬНАЯ карточка (см. описание MF-33/MF-409), этот прогон —
// разовый bootstrap с честной пометкой качества каждой записи.
//
// Точность температур/сопла критична (испорченная печать у пользователя) — каждая запись несёт
// `sourceUrl` + `quality`: 'vendor_tds' (со страницы бренда/офиц. вики, наиболее надёжно) или
// 'community_review' (сторонний обзор/форум — используется только если официальный источник
// физически недоступен автоматическому клиенту, см. U3Print ниже).
//
// MF-403 (2026-07-10, Фаза 2 эпика MF-31, Fullstack): добор RU-слоя до ≥7 брендов из списка
// market.md (REC/Bestfilament/FDplast/Filamentarno!/PrintProduct/U3Print/KREMEN) — все семь
// теперь имеют ≥1 реальную линейку. Filamentarno! (у которого на прогоне MF-409 официальный
// сайт отдавал 404/битую кодировку) на повторной проверке 2026-07-10 отдаёт корректный ответ —
// характеристики PLA+ Standart сняты напрямую с filamentarno.ru/id=75. PrintProduct и KREMEN —
// тоже официальные сайты (printproduct3d.ru, kremen.ru). U3Print (u3print.com) отдаёт
// редирект-цикл автоматическому клиенту без сохранения cookie (антибот-защита витрины) —
// значения сняты с зеркальной карточки официального прайс-листа у дистрибьютора lider-3d.ru,
// помечено `community_review` + `data_quality_note`, тот же принцип честной пометки, что и у
// FDplast.
//
// Дедуп — та же схема, что у остальных импортёров: `materials` через `unique(vendor_id, slug)`,
// `material_variants` через `material_variants_dedup_uidx`, `machines` через `content_hash`.
//
// Запуск: pnpm --filter @portal/api exec tsx scripts/import-ru-vendors-bootstrap.ts [--dry-run]
// env: DATABASE_URL (обяз., кроме --dry-run).

import { createHash } from "node:crypto";
import { pool } from "../src/db/client.ts";
import { assertSafeBootstrapTarget } from "./dev-seed-guard.ts";

const DRY_RUN = process.argv.includes("--dry-run");

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

interface RuVendor {
  slug: string;
  name: string;
}

const VENDORS: RuVendor[] = [
  { slug: "rec", name: "REC" },
  { slug: "bestfilament", name: "Bestfilament" },
  { slug: "fdplast", name: "FDplast" },
  { slug: "filamentarno", name: "Filamentarno!" },
  { slug: "picaso-3d", name: "PICASO 3D" },
  { slug: "printproduct", name: "PrintProduct" },
  { slug: "u3print", name: "U3Print" },
  { slug: "kremen", name: "KREMEN" },
];

interface RuMaterialLine {
  vendorSlug: string;
  familySlug: string; // должен совпадать с material_types.slug, заводимым SpoolmanDB-импортёром
  familyName: string;
  lineName: string; // напр. "PLA", "Relax (PETG)", "Flex"
  specs: Record<string, unknown>;
  sourceUrl: string;
  quality: "vendor_tds" | "community_review";
  variants: Array<{ colorName: string; diameterMm: number }>;
}

// Зеркалит word-boundary regex бэкфилла Фазы 1 (MF-408,
// db/migrations/20260710130000_compat_material_flags.sql), применённое при INSERT новой строки
// material_types (та миграция сработала на пустой таблице — см. тот же комментарий в
// import-materials-bootstrap.ts). requires_chamber/needs_chamber больше НЕ пишем в
// materials.specs (было в первой версии этого файла) — семейный флаг живёт только на
// material_types, per-product override контрактом Фазы 1 не предусмотрен.
const CHAMBER_RE = /\b(abs|asa|pc|nylon|polycarbonate)\b/i;
const DRYING_RE = /\b(pa|nylon|pc|polycarbonate)\b/i;
const DIRECT_DRIVE_RE = /\b(tpu|tpe|flex)\b/i;
function requiresFlagsFor(slug: string, name: string): { requiresChamber: boolean; requiresDrying: boolean; requiresDirectDrive: boolean } {
  const haystack = `${slug} ${name}`;
  return {
    requiresChamber: CHAMBER_RE.test(haystack),
    requiresDrying: DRYING_RE.test(haystack),
    requiresDirectDrive: DIRECT_DRIVE_RE.test(haystack),
  };
}

// Значения сведены вручную 2026-07-10 со страниц REC Wiki / bestfilament.ru / 3dtoday.ru
// (community-обзор для FDplast — офиц. TDS не найден за время прогона, см. quality). Каждая
// запись — минимальный набор SKU (по одному нейтральному цвету), не полный каталог цветов
// бренда (это не наша задача — здесь bootstrap-факт «линейка существует и имеет вот такие
// параметры», не полный каталог всех расцветок).
const FILAMENTS: RuMaterialLine[] = [
  {
    vendorSlug: "rec",
    familySlug: "pla",
    familyName: "PLA",
    lineName: "REC PLA",
    specs: {
      extruder_temp_min_c: 200,
      extruder_temp_max_c: 220,
      bed_temp_min_c: 0,
      bed_temp_max_c: 60,
      density_g_cm3: 1.25,
    },
    sourceUrl: "https://rec3d.ru/rec-wiki/pla-plastik-kharakteristiki-nastroyki-pechati-sovety/",
    quality: "vendor_tds",
    variants: [{ colorName: "Natural", diameterMm: 1.75 }],
  },
  {
    vendorSlug: "rec",
    familySlug: "petg",
    familyName: "PETG",
    lineName: "REC Relax (PETG)",
    specs: {
      extruder_temp_min_c: 215,
      extruder_temp_max_c: 245,
      bed_temp_min_c: 60,
      bed_temp_max_c: 80,
      density_g_cm3: 1.3,
    },
    sourceUrl: "https://rec3d.ru/rec-wiki/petg-obzor-materiala-nastroyki-3d-pechati-i-sovety-po-ustraneniyu-problem/",
    quality: "vendor_tds",
    variants: [{ colorName: "Black", diameterMm: 1.75 }],
  },
  {
    vendorSlug: "rec",
    familySlug: "abs",
    familyName: "ABS",
    lineName: "REC ABS",
    specs: {
      extruder_temp_min_c: 240,
      extruder_temp_max_c: 270,
      bed_temp_min_c: 90,
      bed_temp_max_c: 110,
    },
    sourceUrl: "https://rec3d.ru/rec-wiki/3d-pechat-plastikom-abs-nastroyki-sovety-i-layfkhaki/",
    quality: "vendor_tds",
    variants: [{ colorName: "White", diameterMm: 1.75 }],
  },
  {
    vendorSlug: "rec",
    familySlug: "tpu",
    familyName: "TPU",
    lineName: "REC Flex",
    specs: {
      extruder_temp_min_c: 220,
      extruder_temp_max_c: 240,
      bed_temp_min_c: 60,
      bed_temp_max_c: 80,
      density_g_cm3: 1.1,
      tpu_shore_hardness: "88A",
    },
    sourceUrl: "https://rec3d.ru/rec-wiki/flex/",
    quality: "vendor_tds",
    variants: [{ colorName: "Black", diameterMm: 1.75 }],
  },
  {
    vendorSlug: "bestfilament",
    familySlug: "pla",
    familyName: "PLA",
    lineName: "Bestfilament PLA",
    specs: {
      extruder_temp_min_c: 190,
      extruder_temp_max_c: 230,
      bed_temp_min_c: 0,
      bed_temp_max_c: 60,
      density_g_cm3: 1.24,
    },
    sourceUrl: "https://bestfilament.ru/pla-1-1.75-natural/",
    quality: "vendor_tds",
    variants: [{ colorName: "Natural", diameterMm: 1.75 }],
  },
  {
    vendorSlug: "fdplast",
    familySlug: "pla",
    familyName: "PLA",
    lineName: "FDplast PLA",
    specs: {
      extruder_temp_min_c: 210,
      extruder_temp_max_c: 215,
      bed_temp_min_c: 35,
      bed_temp_max_c: 50,
      data_quality_note: "Источник — обзор сообщества (3dtoday.ru), не официальный TDS бренда; значения требуют сверки при появлении парсер-агента.",
    },
    sourceUrl: "https://3dtoday.ru/blogs/snikers651/pla-plastic-fd-plast-print-settings",
    quality: "community_review",
    variants: [{ colorName: "Unspecified", diameterMm: 1.75 }],
  },
  // Добор до ≥7 RU-брендов (MF-403, 2026-07-10) — см. header. filamentarno.ru снова отдаёт
  // корректный ответ (была недоступна на прогоне MF-409), карточка PLA+ Standart id=75.
  {
    vendorSlug: "filamentarno",
    familySlug: "pla",
    familyName: "PLA",
    lineName: "Filamentarno! PLA+ Standart",
    specs: {
      extruder_temp_min_c: 220,
      extruder_temp_max_c: 240,
      bed_temp_min_c: 40,
      bed_temp_max_c: 60,
      density_g_cm3: 1.24,
    },
    sourceUrl: "https://filamentarno.ru/id=75",
    quality: "vendor_tds",
    variants: [{ colorName: "Unspecified", diameterMm: 1.75 }],
  },
  {
    vendorSlug: "printproduct",
    familySlug: "pla",
    familyName: "PLA",
    lineName: "PrintProduct PLA GEO",
    specs: {
      extruder_temp_min_c: 195,
      extruder_temp_max_c: 240,
      bed_temp_min_c: 60,
      bed_temp_max_c: 60,
    },
    sourceUrl: "https://printproduct3d.ru/categories/pla-geo-printproduct",
    quality: "vendor_tds",
    variants: [{ colorName: "Unspecified", diameterMm: 1.75 }],
  },
  {
    vendorSlug: "u3print",
    familySlug: "pla",
    familyName: "PLA",
    lineName: "U3Print HP PLA",
    specs: {
      extruder_temp_min_c: 195,
      extruder_temp_max_c: 205,
      bed_temp_min_c: 50,
      bed_temp_max_c: 55,
      data_quality_note:
        "Официальный сайт (u3print.com) отдаёт редирект-цикл автоматическому клиенту — значения сняты с карточки дистрибьютора lider-3d.ru, зеркалящей заводской прайс-лист; требуют сверки при появлении парсер-агента.",
    },
    sourceUrl: "https://lider-3d.ru/catalog/materialy/plastik_dlya_3d_printerov/hp_pla_plastik_u3print_dlya_3d_printera/",
    quality: "community_review",
    variants: [{ colorName: "Natural", diameterMm: 1.75 }],
  },
  {
    vendorSlug: "kremen",
    familySlug: "pla",
    familyName: "PLA",
    lineName: "KREMEN PLA",
    specs: {
      extruder_temp_min_c: 200,
      extruder_temp_max_c: 215,
      bed_temp_min_c: 55,
      bed_temp_max_c: 60,
    },
    sourceUrl: "https://kremen.ru/catalog/3dpechat/filament/kremen-premium-quality/filament-kremen-pla/",
    quality: "vendor_tds",
    variants: [{ colorName: "White", diameterMm: 1.75 }],
  },
];

interface RuMachine {
  vendorSlug: string;
  model: string;
  // Форма — канонический контракт Фазы 1 (MF-408, domain.model.md § «Движок совместимости —
  // фундамент данных», п.2): max_hotend_temp_c/chamber/chamber_max_temp_c/extruder_count —
  // те же ключи, что читает compat.check, не собственные имена этого скрипта.
  specs: {
    build_volume: { x: number; y: number; z: number; shape: "rectangular" };
    max_hotend_temp_c: number;
    chamber: "none" | "passive" | "active";
    chamber_max_temp_c?: number;
    extruder_count: number;
    kinematics: string;
  };
  sourceUrl: string;
}

// PICASO 3D — единственный крупный RU-производитель принтеров вне охвата
// slicer-profiles-db (западные слайсеры не несут его машинные профили), явно назван в эпике
// («российские принтеры (PICASO 3D, Wanhao-клоны)»). Данные сверены 2026-07-10 с
// picaso-3d.ru/ru/products/printers/xseries2/ (актуальная линейка Designer X/X PRO, серия 2).
// nozzle_hardened/filament_dia_mm/extruder_drive намеренно не заполнены — источник не подтвердил
// эти конкретные значения (страница отдаёт только «запасные сопла в комплекте», без марки стали);
// честный null лучше угаданного числа для полей, где ошибка стоит пользователю сопла/печати.
const MACHINES: RuMachine[] = [
  {
    vendorSlug: "picaso-3d",
    model: "Designer X C2",
    specs: {
      build_volume: { x: 201, y: 201, z: 210, shape: "rectangular" },
      max_hotend_temp_c: 500,
      chamber: "active",
      chamber_max_temp_c: 80,
      extruder_count: 1,
      kinematics: "cartesian",
    },
    sourceUrl: "https://picaso-3d.ru/ru/products/printers/xseries2/",
  },
  {
    vendorSlug: "picaso-3d",
    model: "Designer X PRO C2",
    specs: {
      build_volume: { x: 201, y: 201, z: 210, shape: "rectangular" },
      max_hotend_temp_c: 500,
      chamber: "active",
      chamber_max_temp_c: 80,
      extruder_count: 2,
      kinematics: "cartesian",
    },
    sourceUrl: "https://picaso-3d.ru/ru/products/printers/xseries2/",
  },
];

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(record[k])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
function contentHash(vendorSlug: string, model: string, specs: unknown): Buffer {
  return createHash("sha256")
    .update(stableStringify({ vendor: vendorSlug, model, specs }))
    .digest();
}

async function main(): Promise<void> {
  if (!DRY_RUN) await assertSafeBootstrapTarget(pool);
  let vendorsUpserted = 0;
  let materialsUpserted = 0;
  let variantsUpserted = 0;
  let machinesUpserted = 0;
  let machinesDuplicate = 0;

  const vendorIdBySlug = new Map<string, string>();
  for (const v of VENDORS) {
    if (DRY_RUN) {
      vendorIdBySlug.set(v.slug, v.slug);
      vendorsUpserted += 1;
      continue;
    }
    const res = await pool.query<{ id: string }>(
      `insert into vendors (slug, name) values ($1, $2)
       on conflict (slug) do update set name = excluded.name
       returning id`,
      [v.slug, v.name],
    );
    vendorIdBySlug.set(v.slug, res.rows[0]!.id);
    vendorsUpserted += 1;
  }

  const materialTypeIdBySlug = new Map<string, string>();
  async function materialTypeId(slug: string, name: string): Promise<string> {
    const cached = materialTypeIdBySlug.get(slug);
    if (cached) return cached;
    if (DRY_RUN) {
      materialTypeIdBySlug.set(slug, slug);
      return slug;
    }
    // on conflict do nothing: семейные дефолты (default_extruder_temp_*, default_density) уже
    // могли быть заведены SpoolmanDB-импортёром — RU-слой не должен их перетирать своими,
    // per-product точными значениями (те лежат ниже, на materials.specs). requires_chamber/
    // requires_drying/requires_direct_drive — та же word-boundary эвристика, что и в
    // import-materials-bootstrap.ts (см. requiresFlagsFor выше) — нужна и здесь на случай, если
    // RU-слой создаёт material_type ПЕРВЫМ (порядок прогона двух импортёров не гарантирован).
    const flags = requiresFlagsFor(slug, name);
    const res = await pool.query<{ id: string }>(
      `insert into material_types (slug, name, requires_chamber, requires_drying, requires_direct_drive)
       values ($1, $2, $3, $4, $5)
       on conflict (slug) do nothing
       returning id`,
      [slug, name, flags.requiresChamber, flags.requiresDrying, flags.requiresDirectDrive],
    );
    const id = res.rows[0]?.id ?? (await pool.query<{ id: string }>(`select id from material_types where slug = $1`, [slug])).rows[0]!.id;
    materialTypeIdBySlug.set(slug, id);
    return id;
  }

  for (const line of FILAMENTS) {
    const vid = vendorIdBySlug.get(line.vendorSlug);
    if (!vid) throw new Error(`Неизвестный vendorSlug у филамента: ${line.vendorSlug}`);
    const specs = { ...line.specs, source_url: line.sourceUrl, data_quality: line.quality };
    const slug = slugify(line.lineName);

    if (DRY_RUN) {
      materialsUpserted += 1;
      variantsUpserted += line.variants.length;
      continue;
    }

    const mtid = await materialTypeId(line.familySlug, line.familyName);
    const materialRes = await pool.query<{ id: string }>(
      `insert into materials (kind, vendor_id, material_type_id, slug, name, specs, source)
       values ('filament', $1, $2, $3, $4, $5::jsonb, 'manual')
       on conflict (vendor_id, slug) do update set
         material_type_id = excluded.material_type_id, name = excluded.name, specs = excluded.specs
       returning id`,
      [vid, mtid, slug, line.lineName, JSON.stringify(specs)],
    );
    const materialId = materialRes.rows[0]!.id;
    materialsUpserted += 1;

    for (const variant of line.variants) {
      await pool.query(
        `insert into material_variants (material_id, color_name, diameter_mm, source, external_ref)
         values ($1, $2, $3, 'manual', $4)
         on conflict (material_id, color_name, diameter_mm) do update set
           source = 'manual', external_ref = excluded.external_ref, updated_at = now()`,
        [materialId, variant.colorName, variant.diameterMm, line.sourceUrl],
      );
      variantsUpserted += 1;
    }
  }

  for (const machine of MACHINES) {
    const vid = vendorIdBySlug.get(machine.vendorSlug);
    if (!vid) throw new Error(`Неизвестный vendorSlug у станка: ${machine.vendorSlug}`);
    const hash = contentHash(machine.vendorSlug, machine.model, machine.specs);
    const provenance: Record<string, { source: string; source_url: string; ts: string; confidence: number }> = {};
    const ts = new Date().toISOString();
    for (const field of Object.keys(machine.specs)) {
      provenance[field] = { source: "ru-vendors-manual", source_url: machine.sourceUrl, ts, confidence: 0.9 };
    }

    if (DRY_RUN) {
      machinesUpserted += 1;
      continue;
    }

    const res = await pool.query(
      `insert into machines (craft, kind, vendor_id, model, specs, schema_version, integration, source, verified, field_provenance, status, content_hash)
       values ('3d_printing', 'fdm_printer', $1, $2, $3::jsonb, 1, 'none', 'community', true, $4::jsonb, 'active', $5)
       on conflict (content_hash) where content_hash is not null do nothing
       returning id`,
      [vid, machine.model, JSON.stringify(machine.specs), JSON.stringify(provenance), hash],
    );
    if (res.rows.length > 0) machinesUpserted += 1;
    else machinesDuplicate += 1;
  }

  console.log(`Вендоры: ${vendorsUpserted}`);
  console.log(`Линейки филамента (materials): ${materialsUpserted}`);
  console.log(`SKU (material_variants): ${variantsUpserted}`);
  console.log(`Станки (machines): ${machinesUpserted} добавлено/обновлено${machinesDuplicate ? `, ${machinesDuplicate} уже были (content_hash)` : ""}`);
  if (DRY_RUN) console.log("(dry-run, запись в БД пропущена)");

  if (!DRY_RUN) await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
