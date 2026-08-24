// Bootstrap-импорт каталога станков (MF-405, эпик MF-32 § «Bootstrap-золото — машинные
// JSON-профили слайсеров»). Заливает канонические записи в `machines` из структурных (без LLM)
// машинных профилей слайсеров — SimplyPrint/slicer-profiles-db (github.com/SimplyPrint/
// slicer-profiles-db), агрегатора OrcaSlicer/PrusaSlicer/BambuStudio/PrusaSlicer-совместимых
// форков + Cura, уже прогнанного через их squash.py (inherits/include-цепочки резолвнуты —
// значения в `out/models/*/*/machine_profiles.json` финальные, кроме ветки cura, где squash
// эту цепочку не разворачивает и профиль остаётся частичным).
//
// Источник данных (`out/models/<id>/<slicer>/machine_profiles.json` + `out/profile_map_out.json`,
// 337 канонических id) клонируется мелко и точечно (`--filter=blob:none --sparse`, паттерны
// только на `machine_profiles.json` + `profile_map_out.json` — полное дерево `out/` тянет ~450МБ
// filament/print-профилей, которые этому импортёру не нужны, реальный трафик ~60МБ) во временную
// директорию и удаляется после прогона; либо путь к уже смонтированному чекауту передаётся
// флагом --source-dir (для повторных локальных прогонов без сети).
//
// Слиcер выбирается по приоритету источника (богаче структура → выше): bambustudio > orcaslicer >
// prusaslicer > crealityprint > elegooslicer > anycubicslicer > superslicer, и только если ни один
// из них не покрывает id — читаем cura (82 id только там; из них 74 несут собственные
// machine_width/depth/height без обращения к цепочке inherits, остальные 8 — частично
// unresolved-профиль, пропускаются). vendor/model берутся из profile_map_out.json (у него уже
// есть авторитетное имя вендора для каждой пары id×слайсер), не из текста самого JSON-профиля —
// там подчас лежит внутренний код вендора без человекочитаемого имени (bambustudio отдаёт "BBL",
// не "Bambu Lab"). Разные слайсеры отдают вендора с разным написанием одного и того же бренда
// (Creality/Creality3D, Elegoo/ELEGOO, Prusa/Prusa3D/PrusaResearch, BBL, …) — VENDOR_ALIASES ниже
// схлопывает известные варианты в один канонический vendors-ряд, иначе один вендор задвоился бы
// под разными slug при выборе разных слайсеров для разных его моделей.
//
// build_volume — два разных сериализатора одного и того же прямоугольника плиты стола:
// bambustudio/orcaslicer кладут `printable_area` (массив точек "XxY") + `printable_height`;
// prusaslicer-семейство (prusaslicer/superslicer/crealityprint/anycubicslicer/elegooslicer) кладёт
// `bed_shape` (одна строка "x,y" через запятую, форма — CSV-точки) + `max_print_height`. Оба
// сводятся к bounding box (parseArea ниже). Диаметры сопла берём из ключей `variants` (сам
// слайсер группирует профиль по соплу), кинематику — из `printer_structure`, когда слайсер её
// пишет (bambustudio/orcaslicer; на остальных источниках это поле отсутствует — оставляем пустым,
// не гадаем).
//
// Плаузибилити (schema.ts § `machines.status`): без вменяемого build_volume (0 < x,y,z ≤ 2000мм)
// запись не идёт в канон вообще (не quarantined — quarantine предполагает, что запись УЖЕ несёт
// хоть какую-то полезную структуру и ждёт разбора человеком; здесь разбирать нечего, это просто
// пропуск источника). vendor="Custom" (2 id — заглушки "Generic Klipper/Marlin/RRF/ToolChanger
// Printer", не реальный вендор/модель) пропускаются тем же путём.
//
// Идемпотентность — `content_hash` (sha256 стабильного {vendor, model, specs}) + partial unique
// index `machines_content_hash_uidx` (см. schema.ts): повторный прогон с тем же исходником не
// плодит дубли, `ON CONFLICT (content_hash) DO NOTHING`. Лог прогона печатает
// найдено/добавлено/пропущено (дубль-конфликт vs implausible/no-vendor) отдельно.
//
// Лицензия источника: в slicer-profiles-db нет файла LICENSE (README называет его "an open
// database", явного гранта нет; upstream-слайсеры — AGPL, но неясно, расширяется ли copyleft на
// извлечённые данные). Импортёр не копирует файлы/код репозитория и не хранит его JSON — только
// извлекает фактические характеристики устройства (объём печати, диаметр сопла, кинематика),
// которые сами по себе не являются объектом авторского права ни в одной обычной юрисдикции (факт
// о физическом продукте, не творческое произведение) — та же практика, что у любого сайта-
// агрегатора спеков (All3DP и т.п.). `source_url` в field_provenance указывает на конкретный файл
// источника для проверяемости/атрибуции. Итоговое решение по допустимости источника — see MF-405
// PR/issue comment; юридический риск явно поднят там для видимости CTO, не блокирует поставку.
//
// Запуск (готовый прогон на дев-стенде — сеть нужна для клонирования источника):
//   pnpm --filter @portal/api exec tsx scripts/import-machines-bootstrap.ts
//   опции: --source-dir <path> (использовать уже склонированный чекаут вместо клонирования),
//          --dry-run (распарсить и посчитать, ничего не писать в БД), --limit N (первые N id —
//          для быстрой проверки).
// env: DATABASE_URL (обяз.).

import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

import { pool } from "../src/db/client.ts";
import { resolveVendorName as resolveVendor } from "../src/modules/catalog/public/operations.ts";
import { assertSafeBootstrapTarget } from "./dev-seed-guard.ts";

const SOURCE_REPO = "https://github.com/SimplyPrint/slicer-profiles-db";
const SLICER_PRIORITY = ["bambustudio", "orcaslicer", "prusaslicer", "crealityprint", "elegooslicer", "anycubicslicer", "superslicer"] as const;

const args = process.argv.slice(2);
function flagValue(name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}
const DRY_RUN = args.includes("--dry-run");
const LIMIT = flagValue("--limit") ? Number(flagValue("--limit")) : undefined;
const SOURCE_DIR_ARG = flagValue("--source-dir");

// Алиасы вендора (BBL→Bambu Lab, Sovol/"Sovol 3D"→sovol, …) и slugify-фолбэк — общие с
// entity resolution пайплайном (MF-406), вынесены в src/modules/catalog/infrastructure/vendor-normalize.ts, чтобы
// bootstrap-импорт и resolve-пайплайн схлопывали одного вендора в один vendors-ряд одинаково.
const SKIP_VENDORS = new Set(["Custom"]); // заглушки generic-прошивок, не реальный вендор

// "0x0", "228x3", … | "3,3" и т.п. — общая точка: список "X x Y" через запятую или JSON-массив
// таких строк. Возвращает bounding box {x, y} по всем точкам.
function parsePoints(raw: string[] | string): { x: number; y: number } | null {
  const points = Array.isArray(raw) ? raw : raw.split(",");
  const xs: number[] = [];
  const ys: number[] = [];
  for (const p of points) {
    const m = /^\s*(-?[\d.]+)\s*x\s*(-?[\d.]+)\s*$/i.exec(String(p).trim());
    if (!m) continue;
    xs.push(Number(m[1]));
    ys.push(Number(m[2]));
  }
  if (xs.length < 2 || ys.length < 2) return null;
  return { x: Math.max(...xs) - Math.min(...xs), y: Math.max(...ys) - Math.min(...ys) };
}

interface ParsedMachine {
  vendorRaw: string;
  model: string;
  specs: {
    build_volume: { x: number; y: number; z: number; shape: "rectangular" };
    nozzle_diameters?: number[];
    kinematics?: string;
  };
  sourceUrl: string;
}

interface SourceVariant {
  data: Record<string, unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8")) as unknown;
}

function parseNonCura(id: string, slicer: string, vendorRaw: string, model: string, sourceDir: string): ParsedMachine | null {
  const file = join(sourceDir, "out", "models", id, slicer, "machine_profiles.json");
  if (!existsSync(file)) return null;
  const data = readJson(file);
  if (!Array.isArray(data) || !isRecord(data[0])) return null;
  const variants = isRecord(data[0].variants) ? data[0].variants : {};
  const variantValues = Object.values(variants).filter((value): value is SourceVariant => isRecord(value) && isRecord(value.data));
  if (variantValues.length === 0) return null;
  const v0 = variantValues[0]!.data;

  let area: { x: number; y: number } | null = null;
  let z: number | null = null;
  if (v0.printable_area) {
    area = parsePoints(v0.printable_area as string[]);
    z = v0.printable_height != null ? Number(v0.printable_height) : null;
  } else if (v0.bed_shape) {
    area = parsePoints(v0.bed_shape as string);
    z = v0.max_print_height != null ? Number(v0.max_print_height) : null;
  }
  if (!area || z == null || !Number.isFinite(z)) return null;

  const nozzles = Object.keys(variants)
    .map((k) => Number(k))
    .filter((n) => Number.isFinite(n))
    .sort((a, b) => a - b);
  const kinematics = typeof v0.printer_structure === "string" ? v0.printer_structure : undefined;

  return {
    vendorRaw,
    model,
    specs: {
      build_volume: { x: area.x, y: area.y, z, shape: "rectangular" },
      ...(nozzles.length > 0 ? { nozzle_diameters: nozzles } : {}),
      ...(kinematics ? { kinematics } : {}),
    },
    sourceUrl: `${SOURCE_REPO}/blob/main/out/models/${id}/${slicer}/machine_profiles.json`,
  };
}

function parseCura(id: string, sourceDir: string): ParsedMachine | null {
  const file = join(sourceDir, "out", "models", id, "cura", "machine_profiles.json");
  if (!existsSync(file)) return null;
  const data = readJson(file);
  if (!Array.isArray(data) || !isRecord(data[0])) return null;
  const entry = data[0];
  const mm = isRecord(entry.machine_model) ? entry.machine_model : {};
  const vendorRaw = entry.vendor ?? mm.vendor;
  const model = mm.name;
  const x = mm.machine_width != null ? Number(mm.machine_width) : null;
  const y = mm.machine_depth != null ? Number(mm.machine_depth) : null;
  const z = mm.machine_height != null ? Number(mm.machine_height) : null;
  if (typeof vendorRaw !== "string" || typeof model !== "string" || x == null || y == null || z == null) return null;
  if (![x, y, z].every((n) => Number.isFinite(n))) return null;
  return {
    vendorRaw,
    model,
    specs: { build_volume: { x, y, z, shape: "rectangular" } },
    sourceUrl: `${SOURCE_REPO}/blob/main/out/models/${id}/cura/machine_profiles.json`,
  };
}

function isPlausible(specs: ParsedMachine["specs"]): boolean {
  const { x, y, z } = specs.build_volume;
  return [x, y, z].every((n) => Number.isFinite(n) && n > 0 && n <= 2000);
}

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

function cloneSource(): { dir: string; cleanup: () => void } {
  if (SOURCE_DIR_ARG) return { dir: SOURCE_DIR_ARG, cleanup: () => {} };
  const dir = mkdtempSync(join(tmpdir(), "slicer-profiles-db-"));
  console.log(`Клонирую ${SOURCE_REPO} (sparse: out/models/*/*/machine_profiles.json + out/profile_map_out.json) → ${dir}`);
  execFileSync("git", ["clone", "--depth", "1", "--filter=blob:none", "--sparse", SOURCE_REPO, dir], { stdio: "inherit" });
  execFileSync("git", ["sparse-checkout", "init", "--no-cone"], { cwd: dir, stdio: "inherit" });
  execFileSync("git", ["sparse-checkout", "set", "out/models/*/*/machine_profiles.json", "out/profile_map_out.json"], {
    cwd: dir,
    stdio: "inherit",
  });
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

async function main(): Promise<void> {
  if (!DRY_RUN) await assertSafeBootstrapTarget(pool);
  const { dir: sourceDir, cleanup } = cloneSource();
  try {
    const parsedProfileMap = readJson(join(sourceDir, "out", "profile_map_out.json"));
    if (!isRecord(parsedProfileMap)) throw new Error("profile_map_out.json must contain an object");
    const profileMap = parsedProfileMap;
    const modelsDir = join(sourceDir, "out", "models");
    let ids = readdirSync(modelsDir);
    if (LIMIT) ids = ids.slice(0, LIMIT);

    let found = 0;
    let skippedNoData = 0;
    let skippedImplausible = 0;
    let skippedVendor = 0;
    let inserted = 0;
    let skippedDuplicate = 0;

    const vendorIdCache = new Map<string, string>();
    async function vendorId(raw: string): Promise<string | null> {
      const { slug, name } = resolveVendor(raw);
      const cached = vendorIdCache.get(slug);
      if (cached) return cached;
      if (DRY_RUN) {
        vendorIdCache.set(slug, slug); // placeholder id для dry-run счётчиков
        return slug;
      }
      const res = await pool.query<{ id: string }>(
        `insert into vendors (slug, name) values ($1, $2)
         on conflict (slug) do update set name = excluded.name
         returning id`,
        [slug, name],
      );
      const id = res.rows[0]!.id;
      vendorIdCache.set(slug, id);
      return id;
    }

    for (const id of ids) {
      const profile = isRecord(profileMap[id]) ? profileMap[id] : {};
      const availableSlicers = Object.keys(profile);
      const chosenSlicer = SLICER_PRIORITY.find((s) => availableSlicers.includes(s) && existsSync(join(modelsDir, id, s)));
      found += 1;

      let parsed: ParsedMachine | null = null;
      if (chosenSlicer) {
        const sourceNames = profile[chosenSlicer];
        const nameEntry = Array.isArray(sourceNames) && typeof sourceNames[0] === "string" ? sourceNames[0] : undefined;
        if (nameEntry === undefined) {
          skippedNoData += 1;
          continue;
        }
        const slashIdx = nameEntry.indexOf("/");
        const vendorRaw = nameEntry.slice(0, slashIdx);
        const model = nameEntry.slice(slashIdx + 1);
        if (SKIP_VENDORS.has(vendorRaw)) {
          skippedVendor += 1;
          continue;
        }
        parsed = parseNonCura(id, chosenSlicer, vendorRaw, model, sourceDir);
      } else if (existsSync(join(modelsDir, id, "cura"))) {
        parsed = parseCura(id, sourceDir);
        if (parsed && SKIP_VENDORS.has(parsed.vendorRaw)) {
          skippedVendor += 1;
          continue;
        }
      }

      if (!parsed) {
        skippedNoData += 1;
        continue;
      }
      if (!isPlausible(parsed.specs)) {
        skippedImplausible += 1;
        continue;
      }

      const { slug: vendorSlug } = resolveVendor(parsed.vendorRaw);
      const hash = contentHash(vendorSlug, parsed.model, parsed.specs);
      const provenance: Record<string, { source: string; source_url: string; ts: string; confidence: number }> = {};
      const ts = new Date().toISOString();
      for (const field of ["vendor", "model", "build_volume", ...(parsed.specs.nozzle_diameters ? ["nozzle_diameters"] : []), ...(parsed.specs.kinematics ? ["kinematics"] : [])]) {
        provenance[field] = { source: "slicer-profiles-db", source_url: parsed.sourceUrl, ts, confidence: 0.7 };
      }

      if (DRY_RUN) {
        inserted += 1;
        continue;
      }

      const vid = await vendorId(parsed.vendorRaw);
      const res = await pool.query(
        `insert into machines (craft, kind, vendor_id, model, specs, schema_version, integration, source, verified, field_provenance, status, content_hash)
         values ('3d_printing', 'fdm_printer', $1, $2, $3::jsonb, 1, 'none', 'community', false, $4::jsonb, 'active', $5)
         on conflict (content_hash) where content_hash is not null do nothing
         returning id`,
        [vid, parsed.model, JSON.stringify(parsed.specs), JSON.stringify(provenance), hash],
      );
      if (res.rows.length > 0) inserted += 1;
      else skippedDuplicate += 1;
    }

    console.log("");
    console.log(`Найдено (canonical id в источнике): ${found}`);
    console.log(`Добавлено: ${inserted}${DRY_RUN ? " (dry-run, запись в БД пропущена)" : ""}`);
    console.log(
      `Пропущено: ${skippedNoData + skippedImplausible + skippedVendor + skippedDuplicate}` +
        ` (нет пригодных данных: ${skippedNoData}, неправдоподобный build_volume: ${skippedImplausible},` +
        ` не вендор (Custom/generic): ${skippedVendor}, уже импортировано ранее (content_hash): ${skippedDuplicate})`,
    );
    if (inserted < 300 && !DRY_RUN && !LIMIT) {
      console.warn(`⚠️ Добавлено ${inserted} < 300 — цель MF-405 «≥300 канонических записей» не достигнута этим прогоном.`);
    }
  } finally {
    cleanup();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
