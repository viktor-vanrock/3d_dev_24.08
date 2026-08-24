// Bootstrap-импорт каталога филамента (MF-409, Фаза 2 эпика MF-33 § «Импортёр v0»), первый
// источник из требуемых ≥2 (второй — уже живой `import-machines-bootstrap.ts`/MF-405 по
// слайсер-профилям OrcaSlicer/PrusaSlicer/BambuStudio). Заливает `vendors`/`material_types`/
// `materials`/`material_variants` из скомпилированного JSON SpoolmanDB
// (github.com/Donkie/SpoolmanDB, донор — donkie.github.io/SpoolmanDB/filaments.json).
//
// Лицензия источника: SpoolmanDB — MIT (проверено 2026-07-10, LICENSE в корне репозитория),
// прямой импорт фактических характеристик разрешён явно, как и предполагает описание эпика
// MF-33. Атрибуция не требуется контрактом MIT для данных (не software), но `source_url` в
// field_provenance-стиле держим на будущее (см. ниже) — та же практика прозрачности, что и
// в `import-machines-bootstrap.ts`.
//
// Лицензия Open Filament Database (github.com/OpenFilamentCollective/open-filament-database,
// api.openfilamentdatabase.org) — тоже проверена 2026-07-10: репозиторий помечен GitHub
// license-детектором как MIT (LICENSE-файл, copyright OpenFilamentCollective 2025), прямой
// импорт разрешён контрактом лицензии так же, как SpoolmanDB. Импортёр под неё в этом прогоне
// НЕ написан (не потому что лицензия под вопросом — она чистая): её 146 брендов/1982 филамента
// пересекаются с SpoolmanDB по западным брендам и НЕ содержат ни одного RU-бренда (проверено
// вручную по дампу brands/index.json — REC/PICASO 3D/Bestfilament/Filamentarno!/FDplast
// отсутствуют), то есть добавление даёт в основном дубли к уже импортированному SpoolmanDB,
// а не новый охват. Критерий эпика «≥2 источника» уже закрыт SpoolmanDB (филаменты) +
// slicer-profiles-db (железо, MF-405) без неё. Второй проход по Open Filament Database —
// кандидат на отдельную карточку, если понадобится более широкое западное покрытие; лицензия
// зафиксирована здесь и в `docs/epics/domain.model.md` § «Движок совместимости (MF-33
// compat.check)», чтобы не перепроверять с нуля.
//
// Структура источника: плоский список SKU (один JSON-элемент = один цвет/навеска одной
// продуктовой линейки). Группировка в наш `brand → material_type → materials(линейка) →
// material_variants(SKU)` — по (manufacturer, material) по всем элементам: temp/density
// одинаковы у всех цветов одной линейки (проверено на дампе — не варьируются внутри группы),
// поэтому кладутся на `materials.specs`, не на `material_variants`.
//
// material_type (вид полимера, "PLA"/"PETG"/"ABS"/…) — не то же самое, что `material.name`
// у источника (конкретная линейка, "PLA+"/"PETG-CF"/"TPU-95A"): normalizeFamily() ниже отделяет
// базовый вид (по нему фильтрует каталог и считает compat.check семейные дефолты вроде
// «нужна камера») от модификаторов линейки (наполнитель/твёрдость — уходят в `materials.specs`
// по уже принятой конвенции MF-402, см. schema.ts § «Модификаторы/наполнители»).
//
// Дедупликация: `materials` — уже живой `unique (vendor_id, slug)` (MF-31), `material_variants`
// — новый `material_variants_dedup_uidx (material_id, color_name, diameter_mm)`
// (db/migrations/20260710010000_material_variants_dedup.sql) — оба через `ON CONFLICT ... DO
// UPDATE`, повторный прогон обновляет specs/варианты вместо дублей (идемпотентно).
//
// Запуск: pnpm --filter @portal/api exec tsx scripts/import-materials-bootstrap.ts
//   опции: --source-url <url|path> (переопределить донора, для офлайн-теста локальным файлом),
//          --dry-run (распарсить и посчитать, ничего не писать в БД), --limit N.
// env: DATABASE_URL (обяз., кроме --dry-run без БД).

import { readFileSync } from "node:fs";
import { pool } from "../src/db/client.ts";
import { assertSafeBootstrapTarget } from "./dev-seed-guard.ts";

const DEFAULT_SOURCE_URL = "https://donkie.github.io/SpoolmanDB/filaments.json";
const SOURCE_REPO = "https://github.com/Donkie/SpoolmanDB";

const args = process.argv.slice(2);
function flagValue(name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}
const DRY_RUN = args.includes("--dry-run");
const LIMIT = flagValue("--limit") ? Number(flagValue("--limit")) : undefined;
const SOURCE_URL = flagValue("--source-url") ?? DEFAULT_SOURCE_URL;

interface SpoolmanEntry {
  id: string;
  manufacturer: string;
  name: string; // цвет SKU, не линейка
  material: string; // "PLA+", "PETG-CF", "TPU-95A", …
  density?: number | null;
  weight?: number | null;
  spool_type?: string | null;
  diameter: number;
  color_hex?: string | null;
  extruder_temp?: number | null;
  extruder_temp_range?: [number, number] | null;
  bed_temp?: number | null;
  bed_temp_range?: [number, number] | null;
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// Базовые виды полимера/сплава, за которыми закреплены семейные дефолты compat.check
// (нужна ли камера — abs/asa/pc/pa*, желателен ли директ-драйв — tpu). Порядок — от самых
// специфичных префиксов к общим (PA12/PA6/PAHT раньше голого PA, PCTG/PCPBT/PCABS раньше
// голого PC), иначе более общий префикс сматчится первым и потеряет специфику.
const FAMILY_PREFIXES: Array<{ prefix: string; slug: string; name: string }> = [
  { prefix: "PAHT", slug: "pa-ht", name: "PA (высокотемпературный)" },
  { prefix: "PA12", slug: "pa12", name: "PA12" },
  { prefix: "PA6", slug: "pa6", name: "PA6" },
  { prefix: "PA", slug: "pa", name: "PA (нейлон)" },
  { prefix: "PCTG", slug: "pctg", name: "PCTG" },
  { prefix: "PCPBT", slug: "pc-pbt", name: "PC-PBT" },
  { prefix: "PCABS", slug: "pc-abs", name: "PC-ABS" },
  { prefix: "PC+ABS", slug: "pc-abs", name: "PC-ABS" },
  { prefix: "PC", slug: "pc", name: "PC" },
  { prefix: "PETG", slug: "petg", name: "PETG" },
  { prefix: "PPS", slug: "pps", name: "PPS" },
  { prefix: "PLA", slug: "pla", name: "PLA" },
  { prefix: "ABS", slug: "abs", name: "ABS" },
  { prefix: "ASA", slug: "asa", name: "ASA" },
  { prefix: "TPU", slug: "tpu", name: "TPU" },
  { prefix: "TPE", slug: "tpe", name: "TPE" },
  { prefix: "HIPS", slug: "hips", name: "HIPS" },
  { prefix: "PVB", slug: "pvb", name: "PVB" },
  { prefix: "PVA", slug: "pva", name: "PVA" },
  { prefix: "PHA", slug: "pha", name: "PHA" },
  { prefix: "PVDF", slug: "pvdf", name: "PVDF" },
  { prefix: "GREENTEC", slug: "greentec", name: "GreenTEC" },
  { prefix: "BIOFUSION", slug: "biofusion", name: "BioFusion" },
];

interface NormalizedFamily {
  familySlug: string;
  familyName: string;
  fillType?: "carbon" | "glass";
  shoreHardness?: string;
}

// "PETG-CF" → семья petg + fillType carbon; "TPU-95A" → семья tpu + shoreHardness "95A";
// "ABS+GF20" → семья abs + fillType glass. Не матчнутое семейным префиксом (FLAX/PEARL/CF/…) —
// честный fallback на slugify всей строки, без выдумывания несуществующей таксономии.
function normalizeFamily(raw: string): NormalizedFamily {
  const upper = raw.toUpperCase();

  const shoreMatch = /-(\d{2}[AD])$/.exec(upper);
  const shoreHardness = shoreMatch ? shoreMatch[1] : undefined;
  const withoutShore = shoreMatch ? upper.slice(0, shoreMatch.index) : upper;

  const fillMatch = /[-+](CF|GF)\d*$/.exec(withoutShore);
  const fillType = fillMatch ? (fillMatch[1] === "CF" ? ("carbon" as const) : ("glass" as const)) : undefined;
  const withoutFill = fillMatch ? withoutShore.slice(0, fillMatch.index) : withoutShore;

  const match = FAMILY_PREFIXES.find((f) => withoutFill.startsWith(f.prefix));
  if (match) {
    return { familySlug: match.slug, familyName: match.name, fillType, shoreHardness };
  }
  const slug = slugify(raw) || `material-${slugify(raw).slice(0, 8)}`;
  return { familySlug: slug, familyName: raw, fillType, shoreHardness };
}

const HEX6_RE = /^[0-9a-f]{6}$/i;
// Источник иногда даёт 8-значный hex (альфа-канал, разные записи кладут её то в начало, то в
// конец — неоднозначно, угадывать RGB не будем). `material_variants.color_hex` — check на ровно
// 6 знаков (schema.ts), не 6-значные значения просто не пишем, а не роняем весь прогон.
function normalizeColorHex(raw: string | null | undefined): string | null {
  if (!raw) return null;
  return HEX6_RE.test(raw) ? `#${raw.toLowerCase()}` : null;
}

// Зеркалит word-boundary regex бэкфилла Фазы 1 (MF-408,
// db/migrations/20260710130000_compat_material_flags.sql) — та же семантика, применённая при
// INSERT новой строки material_types, а не UPDATE существующей (см. комментарий в materialTypeId).
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

function isValid(entry: SpoolmanEntry): boolean {
  return (
    typeof entry.manufacturer === "string" &&
    entry.manufacturer.trim().length > 0 &&
    typeof entry.material === "string" &&
    entry.material.trim().length > 0 &&
    typeof entry.diameter === "number" &&
    entry.diameter > 0
  );
}

async function loadEntries(): Promise<SpoolmanEntry[]> {
  if (/^https?:\/\//.test(SOURCE_URL)) {
    const res = await fetch(SOURCE_URL);
    if (!res.ok) throw new Error(`Не удалось скачать ${SOURCE_URL}: HTTP ${res.status}`);
    return (await res.json()) as SpoolmanEntry[];
  }
  return JSON.parse(readFileSync(SOURCE_URL, "utf8")) as SpoolmanEntry[];
}

async function main(): Promise<void> {
  if (!DRY_RUN) await assertSafeBootstrapTarget(pool);
  console.log(`Источник: ${SOURCE_URL}`);
  let entries = await loadEntries();
  if (LIMIT) entries = entries.slice(0, LIMIT);

  let found = 0;
  let skippedInvalid = 0;
  let materialLines = 0;
  let variantsUpserted = 0;

  const vendorIdCache = new Map<string, string>();
  async function vendorId(rawManufacturer: string): Promise<string> {
    const slug = slugify(rawManufacturer);
    const cached = vendorIdCache.get(slug);
    if (cached) return cached;
    if (DRY_RUN) {
      vendorIdCache.set(slug, slug);
      return slug;
    }
    const res = await pool.query<{ id: string }>(
      `insert into vendors (slug, name) values ($1, $2)
       on conflict (slug) do update set name = excluded.name
       returning id`,
      [slug, rawManufacturer],
    );
    const id = res.rows[0]!.id;
    vendorIdCache.set(slug, id);
    return id;
  }

  const materialTypeIdCache = new Map<string, string>();
  async function materialTypeId(family: NormalizedFamily, entry: SpoolmanEntry): Promise<string> {
    const cached = materialTypeIdCache.get(family.familySlug);
    if (cached) return cached;
    if (DRY_RUN) {
      materialTypeIdCache.set(family.familySlug, family.familySlug);
      return family.familySlug;
    }
    // Дефолты семейства (плотность/темп.) заполняются только при первом создании строки —
    // на конфликте трогаем лишь name, чтобы не затирать более точные значения последующими
    // прогонами/ручными правками (см. header-комментарий про идемпотентность). requires_chamber/
    // requires_drying/requires_direct_drive — та же word-boundary regex-эвристика, что бэкфилл
    // Фазы 1 (MF-408, db/migrations/20260710130000_compat_material_flags.sql) применял к уже
    // существовавшим строкам: та миграция сработала на пустой material_types (эта же таблица
    // впервые реально наполняется этим импортёром) — здесь та же логика ПРИ INSERT, иначе новые
    // строки остались бы с дефолтным false и compat.check тихо потерял бы ABS→камера/TPU→директ-драйв.
    const extTempMin = entry.extruder_temp_range?.[0] ?? entry.extruder_temp ?? null;
    const extTempMax = entry.extruder_temp_range?.[1] ?? entry.extruder_temp ?? null;
    const bedTempMin = entry.bed_temp_range?.[0] ?? entry.bed_temp ?? null;
    const bedTempMax = entry.bed_temp_range?.[1] ?? entry.bed_temp ?? null;
    const typicalExtTemp = extTempMin != null && extTempMax != null ? Math.round((extTempMin + extTempMax) / 2) : (extTempMax ?? extTempMin);
    const typicalBedTemp = bedTempMin != null && bedTempMax != null ? Math.round((bedTempMin + bedTempMax) / 2) : (bedTempMax ?? bedTempMin);
    const flags = requiresFlagsFor(family.familySlug, family.familyName);
    const res = await pool.query<{ id: string }>(
      `insert into material_types
         (slug, name, default_density_g_cm3, default_extruder_temp_min_c, default_extruder_temp_max_c,
          default_bed_temp_min_c, default_bed_temp_max_c, default_extruder_temp_c, default_bed_temp_c,
          requires_chamber, requires_drying, requires_direct_drive)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       on conflict (slug) do update set name = excluded.name
       returning id`,
      [
        family.familySlug,
        family.familyName,
        entry.density ?? null,
        extTempMin,
        extTempMax,
        bedTempMin,
        bedTempMax,
        typicalExtTemp ?? null,
        typicalBedTemp ?? null,
        flags.requiresChamber,
        flags.requiresDrying,
        flags.requiresDirectDrive,
      ],
    );
    const id = res.rows[0]!.id;
    materialTypeIdCache.set(family.familySlug, id);
    return id;
  }

  // Группировка входа по (manufacturer, material) — линейка продукта, см. header-комментарий.
  const lines = new Map<string, { vendorRaw: string; materialRaw: string; entries: SpoolmanEntry[] }>();
  for (const entry of entries) {
    found += 1;
    if (!isValid(entry)) {
      skippedInvalid += 1;
      continue;
    }
    const key = `${entry.manufacturer} ${entry.material}`;
    const line = lines.get(key);
    if (line) line.entries.push(entry);
    else lines.set(key, { vendorRaw: entry.manufacturer, materialRaw: entry.material, entries: [entry] });
  }

  for (const line of lines.values()) {
    materialLines += 1;
    const family = normalizeFamily(line.materialRaw);
    const first = line.entries[0]!;

    const vid = await vendorId(line.vendorRaw);
    const mtid = await materialTypeId(family, first);

    const specs: Record<string, unknown> = {};
    if (family.fillType) specs.fill_type = family.fillType;
    if (family.shoreHardness) specs.tpu_shore_hardness = family.shoreHardness;
    if (first.density != null) specs.density_g_cm3 = first.density;
    const extTempMin = first.extruder_temp_range?.[0] ?? first.extruder_temp ?? null;
    const extTempMax = first.extruder_temp_range?.[1] ?? first.extruder_temp ?? null;
    if (extTempMin != null) specs.extruder_temp_min_c = extTempMin;
    if (extTempMax != null) specs.extruder_temp_max_c = extTempMax;
    const bedTempMin = first.bed_temp_range?.[0] ?? first.bed_temp ?? null;
    const bedTempMax = first.bed_temp_range?.[1] ?? first.bed_temp ?? null;
    if (bedTempMin != null) specs.bed_temp_min_c = bedTempMin;
    if (bedTempMax != null) specs.bed_temp_max_c = bedTempMax;

    const slug = slugify(line.materialRaw) || `material-${materialLines}`;

    if (DRY_RUN) {
      variantsUpserted += line.entries.length;
      continue;
    }

    const materialRes = await pool.query<{ id: string }>(
      `insert into materials (kind, vendor_id, material_type_id, slug, name, specs, source)
       values ('filament', $1, $2, $3, $4, $5::jsonb, 'import')
       on conflict (vendor_id, slug) do update set
         material_type_id = excluded.material_type_id, name = excluded.name, specs = excluded.specs, source = 'import'
       returning id`,
      [vid, mtid, slug, line.materialRaw, JSON.stringify(specs)],
    );
    const materialId = materialRes.rows[0]!.id;

    for (const entry of line.entries) {
      await pool.query(
        `insert into material_variants
           (material_id, color_name, color_hex, diameter_mm, weight_g, spool_type, source, confidence, external_ref)
         values ($1, $2, $3, $4, $5, $6, 'import', 0.9, $7)
         on conflict (material_id, color_name, diameter_mm) do update set
           color_hex = excluded.color_hex, weight_g = excluded.weight_g, spool_type = excluded.spool_type,
           source = 'import', confidence = excluded.confidence, external_ref = excluded.external_ref, updated_at = now()`,
        [materialId, entry.name, normalizeColorHex(entry.color_hex), entry.diameter, entry.weight ?? null, entry.spool_type ?? null, `${SOURCE_REPO}#${entry.id}`],
      );
      variantsUpserted += 1;
    }
  }

  console.log("");
  console.log(`Найдено записей источника: ${found} (пропущено невалидных: ${skippedInvalid})`);
  console.log(`Линеек (materials): ${materialLines}${DRY_RUN ? " (dry-run, запись в БД пропущена)" : ""}`);
  console.log(`SKU (material_variants) записано/обновлено: ${variantsUpserted}`);

  if (!DRY_RUN) await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
