// Контракт POST /research/printers ↔ GET /printers (MF-878, вердикт CTO MF-839): одна схема
// docs/research/printer.schema.json, читаемая и человеком через будущую форму /research (Front),
// и агентом (researcher-creality) программно. Валидация здесь — ручная (без zod в apps/api,
// см. ideas/create.ts) с ошибками ПО ПОЛЮ (§8.4 «ошибки у полей, никогда не сырой JSON-дамп»).

export const PRINTER_STATUSES = ["announced", "shipping", "eol", "rumored"] as const;
export const PRINTER_KINEMATICS = ["cartesian", "corexy", "delta", "scara", "idex", "polar", "belt"] as const;
export const PRINTER_TYPES = ["fdm", "resin-lcd", "resin-dlp", "resin-sla"] as const;
export const PRINTER_CONFIDENCE = ["high", "medium", "low"] as const;
export const TOOLHEAD_KINDS = ["laser", "cnc-spindle", "cutter", "pen", "foodpaste", "other"] as const;

// Секции printer.schema.json, целиком уходящие в `specs` jsonb (детальная карточка §9.2) —
// facet-подмножество из них также летит в реляционные колонки, см. extractFacets ниже.
export const SPEC_SECTIONS = [
  "build_volume",
  "hotend",
  "bed",
  "speed",
  "multimaterial",
  "toolhead_extras",
  "connectivity",
  "materials_supported",
  "dimensions_mm",
  "price",
  "unique_features",
] as const;

// Секции-объекты, где отдельные листовые поля правдоподобно заполняются РАЗНЫМИ источниками в
// разное время (вендор-спека даёт `bed.max_temp_c`, ресёрчер позже добавляет `bed.surface` из
// обзора) — провенанс/конфликт для них ведётся на уровне листа (`bed.max_temp_c`), не всей секции.
// Ровно так уже описан контракт `field_sources` в printers.research.md §8.3
// (`{"hotend.max_temp_c": 0}` — пример там же, дотнотация листа, не секции целиком): секционная
// гранулярность в первой реализации (MF-878) была отклонением от этого контракта, не решением —
// см. разбор в docs/epics/domain.model.md § «printers — провенанс по листу, не по секции».
// Без этого партиальный второй сейв секции (частая ресёрчер-эргономика — «нашёл три поля из
// тридцати», §8.3) молча стирал соседние листья, которых не было в новом теле запроса.
export const LEAF_PROVENANCE_SECTIONS = ["build_volume", "hotend", "bed", "speed", "multimaterial", "connectivity", "price", "dimensions_mm", "media"] as const;

export interface FieldError {
  field: string;
  message: string;
}

export interface PrinterFacets {
  build_volume_x: number | null;
  build_volume_y: number | null;
  build_volume_z: number | null;
  hotend_max_temp_c: number | null;
  hotend_max_flow_mm3s: number | null;
  hotend_hardened: boolean | null;
  bed_max_temp_c: number | null;
  bed_auto_leveling: string | null;
  multimaterial_supported: boolean;
  has_laser: boolean;
  has_cnc: boolean;
  nozzle_swappable: boolean | null;
  moonraker: boolean | null;
  lan_mode: boolean | null;
  price_msrp_usd: number | null;
  price_ru_rub: number | null;
  price_ru_updated_at: string | null;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function numOrNull(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function boolOrNull(v: unknown): boolean | null {
  return typeof v === "boolean" ? v : null;
}

function strOrNull(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

// slug — рабочий id ресёрчера (printer.schema.json `id`): brand.model в lowercase, разделитель
// «.» между брендом и моделью, «-» внутри слов. НЕ каноническая PK (та — id uuid).
export function slugifyPart(raw: string): string {
  return raw
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
}

export function deriveSlug(brand: string, model: string): string {
  return `${slugifyPart(brand)}.${slugifyPart(model)}`;
}

const SLUG_RE = /^[\p{L}\p{N}-]+\.[\p{L}\p{N}-]+$/u;

export function isValidSlug(value: string): boolean {
  return SLUG_RE.test(value);
}

// Плоские facet-колонки (§9.1) из вложенных секций схемы — только то, по чему реально
// фильтруют/сортируют; остальное живёт целиком в specs jsonb (detail-страница §9.2).
export function extractFacets(body: Record<string, unknown>): PrinterFacets {
  const buildVolume = isPlainObject(body.build_volume) ? body.build_volume : {};
  const hotend = isPlainObject(body.hotend) ? body.hotend : {};
  const bed = isPlainObject(body.bed) ? body.bed : {};
  const multimaterial = isPlainObject(body.multimaterial) ? body.multimaterial : {};
  const connectivity = isPlainObject(body.connectivity) ? body.connectivity : {};
  const price = isPlainObject(body.price) ? body.price : {};
  const toolheadExtras = Array.isArray(body.toolhead_extras) ? body.toolhead_extras : [];

  const hasKind = (kind: string) => toolheadExtras.some((item) => isPlainObject(item) && item.kind === kind);

  return {
    build_volume_x: numOrNull(buildVolume.x),
    build_volume_y: numOrNull(buildVolume.y),
    build_volume_z: numOrNull(buildVolume.z),
    hotend_max_temp_c: numOrNull(hotend.max_temp_c),
    hotend_max_flow_mm3s: numOrNull(hotend.max_flow_mm3s),
    hotend_hardened: boolOrNull(hotend.hardened),
    bed_max_temp_c: numOrNull(bed.max_temp_c),
    bed_auto_leveling: strOrNull(bed.auto_leveling),
    multimaterial_supported: multimaterial.supported === true,
    has_laser: hasKind("laser"),
    has_cnc: hasKind("cnc-spindle") || hasKind("cutter"),
    nozzle_swappable: boolOrNull(hotend.nozzle_swappable),
    moonraker: boolOrNull(connectivity.moonraker),
    lan_mode: boolOrNull(connectivity.lan_mode),
    price_msrp_usd: numOrNull(price.msrp_usd),
    price_ru_rub: numOrNull(price.ru_rub),
    price_ru_updated_at: strOrNull(price.ru_updated_at),
  };
}

// specs jsonb — секции схемы как есть, без домысливания недостающих под-полей (правило
// «неизвестное = null», не пустой объект по умолчанию).
export function extractSpecs(body: Record<string, unknown>): Record<string, unknown> {
  const specs: Record<string, unknown> = {};
  for (const section of SPEC_SECTIONS) {
    if (body[section] !== undefined) specs[section] = body[section];
  }
  return specs;
}

interface ValidationResult {
  errors: FieldError[];
}

// Валидация верхнего уровня (§8.3: обязательные — id/slug, brand, model, _meta; остальное
// опционально, сохранение никогда не блокируется пробелами). Секции — мягкая проверка типа
// (object/array), не построчный обход 60 полей — детальные опечатки ловит фронт-форма живьём.
export function validatePrinterPayload(body: Record<string, unknown>): ValidationResult {
  const errors: FieldError[] = [];

  const brand = body.brand;
  if (typeof brand !== "string" || !brand.trim()) errors.push({ field: "brand", message: "обязательное поле" });
  else if (brand.trim().length > 128) errors.push({ field: "brand", message: "слишком длинное" });

  const model = body.model;
  if (typeof model !== "string" || !model.trim()) errors.push({ field: "model", message: "обязательное поле" });
  else if (model.trim().length > 128) errors.push({ field: "model", message: "слишком длинное" });

  // Контракт использует `slug` (не `id`, см. printers.research.md §1 «id переименовывается в
  // slug»: каноническая PK — printers.id uuid, slug — рабочий SEO-ключ рядом). Принимаем и `id`
  // как алиас — printer.schema.json (файл-докстрока) пока называет то же поле `id`.
  const slugInput = body.slug ?? body.id;
  if (slugInput !== undefined) {
    if (typeof slugInput !== "string" || !isValidSlug(slugInput)) {
      errors.push({ field: "slug", message: "ожидается slug вида brand.model" });
    }
  }

  if (body.aliases !== undefined && !Array.isArray(body.aliases)) {
    errors.push({ field: "aliases", message: "ожидается массив строк" });
  }
  if (body.status !== undefined && !(PRINTER_STATUSES as readonly string[]).includes(body.status as string)) {
    errors.push({ field: "status", message: `ожидается одно из: ${PRINTER_STATUSES.join(", ")}` });
  }
  if (body.kinematics !== undefined && !(PRINTER_KINEMATICS as readonly string[]).includes(body.kinematics as string)) {
    errors.push({ field: "kinematics", message: `ожидается одно из: ${PRINTER_KINEMATICS.join(", ")}` });
  }
  if (body.type !== undefined && !(PRINTER_TYPES as readonly string[]).includes(body.type as string)) {
    errors.push({ field: "type", message: `ожидается одно из: ${PRINTER_TYPES.join(", ")}` });
  }
  if (body.enclosed !== undefined && typeof body.enclosed !== "boolean") {
    errors.push({ field: "enclosed", message: "ожидается true/false" });
  }

  for (const section of ["build_volume", "hotend", "bed", "speed", "multimaterial", "connectivity", "price", "dimensions_mm"] as const) {
    if (body[section] !== undefined && !isPlainObject(body[section])) {
      errors.push({ field: section, message: "ожидается объект" });
    }
  }
  for (const section of ["toolhead_extras", "materials_supported", "unique_features", "sources"] as const) {
    if (body[section] !== undefined && !Array.isArray(body[section])) {
      errors.push({ field: section, message: "ожидается массив" });
    }
  }
  if (body.toolhead_extras !== undefined && Array.isArray(body.toolhead_extras)) {
    body.toolhead_extras.forEach((item, i) => {
      if (!isPlainObject(item) || !(TOOLHEAD_KINDS as readonly string[]).includes(item.kind as string)) {
        errors.push({ field: `toolhead_extras[${i}].kind`, message: `ожидается одно из: ${TOOLHEAD_KINDS.join(", ")}` });
      }
    });
  }

  const meta = body._meta;
  if (!isPlainObject(meta)) {
    errors.push({ field: "_meta", message: "обязательное поле" });
  } else {
    if (typeof meta.filled_by !== "string" || !meta.filled_by.trim()) {
      errors.push({ field: "_meta.filled_by", message: "обязательное поле" });
    }
    if (!(PRINTER_CONFIDENCE as readonly string[]).includes(meta.confidence as string)) {
      errors.push({ field: "_meta.confidence", message: `ожидается одно из: ${PRINTER_CONFIDENCE.join(", ")}` });
    }
    if (meta.gaps !== undefined && !Array.isArray(meta.gaps)) {
      errors.push({ field: "_meta.gaps", message: "ожидается массив" });
    }
  }

  const media = body.media;
  if (media !== undefined && !isPlainObject(media)) {
    errors.push({ field: "media", message: "ожидается объект" });
  }

  return { errors };
}
