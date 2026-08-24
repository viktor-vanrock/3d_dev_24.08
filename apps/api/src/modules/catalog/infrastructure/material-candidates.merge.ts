// Чистое отображение material_candidates.raw → план вставки в vendors/material_types/
// materials/material_variants (MF-846, шаг 2 эпика MF-31/Ф3). В отличие от resolve/merge.ts
// (auto-merge станков по приоритету источника) здесь нет автоматики — это только парсинг
// одного конкретного raw в структуру, которую POST /material-candidates/:id/approve потом
// целиком применяет одной транзакцией по решению человека (см. material-candidates.ts).
// Понимает пока один источник (`spoolman`, MF-721) — raw неизвестного source не парсится
// (approve отвечает 422), новый source добавляет свою ветку сюда, не переписывает эту.
import { normalizeColorName } from "./color-normalize.ts";
import { resolveVendorName } from "./vendor-normalize.ts";

export interface ParsedMaterialCandidate {
  vendorSlug: string;
  vendorName: string;
  materialTypeSlug: string;
  materialTypeName: string;
  materialSlug: string;
  materialName: string;
  materialSpecs: Record<string, unknown>;
  colorName: string;
  colorHex: string | null;
  diameterMm: number;
  weightG: number | null;
  variantSpecs: Record<string, unknown>;
}

const HEX_RE = /^#[0-9a-f]{6}$/;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// jsonb-секция без undefined/null-ключей — те же значения, что materialSpecs/variantSpecs
// пишут в specs, лишние null-поля на каждой строке не нужны (принцип 5 domain.model.md).
function compact(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined && value !== null) out[key] = value;
  }
  return out;
}

function normalizeColorHex(hex: unknown, hexes: unknown): string | null {
  const candidates: unknown[] = [hex, ...(Array.isArray(hexes) ? (hexes as unknown[]) : [])];
  for (const candidate of candidates) {
    if (typeof candidate !== "string") continue;
    const lower = candidate.trim().toLowerCase();
    const normalized = lower.startsWith("#") ? lower : `#${lower}`;
    // material_variants.color_hex constraint (baseline.sql): '^#[0-9a-f]{6}$' — тихо роняем
    // нераспознанный формат (short hex, alpha-канал) в null, не 500 на constraint violation.
    if (HEX_RE.test(normalized)) return normalized;
  }
  return null;
}

function normalizeWeight(weights: unknown): number | null {
  if (!Array.isArray(weights) || weights.length === 0) return null;
  const first: unknown = weights[0];
  const n = typeof first === "number" ? first : Number(first);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

// Продуктовая линейка (третий уровень brand→material→product→variant) — SpoolmanDB даёт имя как
// шаблон с плейсхолдером цвета (`"{color_name} PLA Basic"`); линейка — то, что остаётся после
// вычитания цвета, не сам шаблон. Пустой остаток («шаблон — это просто цвет») схлопывается в вид
// полимера (`materialTypeSlug`/name) — тогда у вендора одна линия на весь material_type, что верно
// для брендов без под-линеек.
function stripColorPlaceholder(nameTemplate: string): string {
  return nameTemplate
    .replace(/\{color_name\}/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function parseSpoolmanRaw(raw: unknown): ParsedMaterialCandidate | null {
  if (!isPlainObject(raw)) return null;

  const manufacturer = raw.manufacturer;
  const material = raw.material;
  const colorName = raw.color_name;
  const diameter = raw.diameter_mm;
  if (typeof manufacturer !== "string" || !manufacturer.trim()) return null;
  if (typeof material !== "string" || !material.trim()) return null;
  if (typeof colorName !== "string" || !colorName.trim()) return null;

  const diameterMm = typeof diameter === "number" ? diameter : Number(diameter);
  if (!Number.isFinite(diameterMm) || diameterMm <= 0) return null;

  const vendor = resolveVendorName(manufacturer);
  const materialTypeSlug = slugify(material);
  if (!materialTypeSlug) return null;

  const nameTemplate =
    typeof raw.name_template === "string" && raw.name_template.trim() ? raw.name_template : typeof raw.name === "string" && raw.name.trim() ? raw.name : material;
  const strippedName = stripColorPlaceholder(nameTemplate);
  const materialSlug = slugify(strippedName) || materialTypeSlug;
  const materialName = strippedName || material;

  return {
    vendorSlug: vendor.slug,
    vendorName: vendor.name,
    materialTypeSlug,
    materialTypeName: material,
    materialSlug,
    materialName,
    materialSpecs: compact({
      density: raw.density,
      extruder_temp: raw.extruder_temp,
      extruder_temp_range: raw.extruder_temp_range,
      bed_temp: raw.bed_temp,
      bed_temp_range: raw.bed_temp_range,
    }),
    colorName: colorName.trim(),
    colorHex: normalizeColorHex(raw.color_hex, raw.color_hexes),
    diameterMm,
    weightG: normalizeWeight(raw.weights),
    variantSpecs: compact({
      finish: raw.finish,
      translucent: raw.translucent,
      glow: raw.glow,
      pattern: raw.pattern,
      multi_color_direction: raw.multi_color_direction,
    }),
  };
}

// «Предложить филамент» из формы Make (MF-1793, п.6) — raw пишется уже в форме
// {vendor, material_type, color_name, notes?}, ничего нормализовать/угадывать не нужно (в
// отличие от SpoolmanDB, где имя линейки вычитается из шаблона с плейсхолдером цвета).
// diameterMm — жёсткий MVP-дефолт 1.75 (подавляющее большинство FDM-катушек, тот же порядок
// решения, что normalizeColorHex тихо роняет нераспознанный формат в null, а не 500).
const DEFAULT_FILAMENT_DIAMETER_MM = 1.75;

export function parseUserSuggestionRaw(raw: unknown): ParsedMaterialCandidate | null {
  if (!isPlainObject(raw)) return null;

  const vendor = raw.vendor;
  const materialType = raw.material_type;
  const colorName = raw.color_name;
  if (typeof vendor !== "string" || !vendor.trim()) return null;
  if (typeof materialType !== "string" || !materialType.trim()) return null;
  if (typeof colorName !== "string" || !colorName.trim()) return null;

  const resolvedVendor = resolveVendorName(vendor);
  const materialTypeSlug = slugify(materialType);
  if (!materialTypeSlug) return null;

  return {
    vendorSlug: resolvedVendor.slug,
    vendorName: resolvedVendor.name,
    materialTypeSlug,
    materialTypeName: materialType,
    materialSlug: materialTypeSlug,
    materialName: materialType,
    materialSpecs: {},
    colorName: normalizeColorName(colorName),
    colorHex: null,
    diameterMm: DEFAULT_FILAMENT_DIAMETER_MM,
    weightG: null,
    variantSpecs: compact({ notes: raw.notes }),
  };
}

// Диспетчер по material_candidates.source — единственная точка входа, которую вызывает route.
// Неизвестный source возвращает null (approve отвечает 422 "unmergeable_source"), новый адаптер
// добавляет case сюда.
export function parseMaterialCandidateRaw(source: string, raw: unknown): ParsedMaterialCandidate | null {
  if (source === "spoolman") return parseSpoolmanRaw(raw);
  if (source === "user_suggestion") return parseUserSuggestionRaw(raw);
  return null;
}
