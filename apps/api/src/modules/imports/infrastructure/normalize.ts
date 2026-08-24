import type { ExternalModelMeta, ModelDraft } from "./connector.ts";

// normalize(meta) → ModelDraft (MF-37/MF-417, стадия 1 — карточка MF-739). Схема ещё не заводит
// колонку «наша лицензия» на models (вне территории Data этой карточки) — LICENSE_MAP ниже это
// НАША таксономия на уровне кода, независимая от схемы: коннектор стадии 2 решает, куда её
// класть (сейчас — только в ModelDraft.license, для будущей колонки/тега). source_license на
// import_bindings — исходная строка как есть (meta.license), для аудита и на случай, если
// маппинг ошибся и её нужно перепривязать вручную.

export type OurLicense = "cc0" | "cc-by" | "cc-by-sa" | "cc-by-nd" | "cc-by-nc" | "cc-by-nc-sa" | "cc-by-nc-nd" | "proprietary" | "unknown";

// Ключи — точные названия лицензий Cults3D (cults3d.com/en/legal/terms), lowercase, пробелы
// схлопнуты в один — normalizeLicenseKey() ниже приводит meta.license к этому виду перед
// поиском. "The Cults3D Original Works License Agreement" и "Standard Digital File License" —
// проприетарные условия площадки, не CC — маппятся в 'proprietary', не 'unknown' (это
// распознанное, не пропущенное значение).
const CULTS3D_LICENSE_MAP: Record<string, OurLicense> = {
  "creative commons - public domain dedication (cc0)": "cc0",
  "creative commons - attribution": "cc-by",
  "creative commons - attribution - share alike": "cc-by-sa",
  "creative commons - attribution - no derivatives": "cc-by-nd",
  "creative commons - attribution - non commercial": "cc-by-nc",
  "creative commons - attribution - non commercial - share alike": "cc-by-nc-sa",
  "creative commons - attribution - non commercial - no derivatives": "cc-by-nc-nd",
  "the cults3d original works license agreement": "proprietary",
  "standard digital file license": "proprietary",
};

function normalizeLicenseKey(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, " ");
}

export function mapLicense(sourceLicense: string): OurLicense {
  return CULTS3D_LICENSE_MAP[normalizeLicenseKey(sourceLicense)] ?? "unknown";
}

// Тот же контракт, что syncModelTags (../models/tags.ts): свободные теги, нижний регистр,
// дедуп, лимит на модель — normalize() обязан отдавать список, который уже пройдёт этот
// констрейнт без дополнительной чистки в коде коннектора.
const MAX_TAGS = 8;
const MAX_TAG_LENGTH = 40;

function normalizeTags(raw: string[], category?: string): string[] {
  const seen = new Set<string>();
  const candidates = category ? [...raw, category] : raw;
  for (const name of candidates) {
    const cleaned = name.trim().toLowerCase().slice(0, MAX_TAG_LENGTH);
    if (cleaned) seen.add(cleaned);
    if (seen.size >= MAX_TAGS) break;
  }
  return [...seen];
}

// «Исходная популярность» (import_bindings.source_popularity) — счётчики источника КАК ЕСТЬ,
// не наши votes_up/downloads_count (домен-документ явно разводит эти понятия). Единственная
// нормализация здесь — защита от мусора источника: отрицательные/нечисловые значения не
// попадают в jsonb, имя счётчика (nb_likes, nb_downloads, …) сохраняется без переименования,
// потому что jsonb-поле по конструкции произвольной формы за источник.
function normalizePopularity(raw: Record<string, number>): Record<string, number> {
  const result: Record<string, number> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) continue;
    result[key] = Math.trunc(value);
  }
  return result;
}

export function normalize(meta: ExternalModelMeta): ModelDraft {
  return {
    title: meta.title.trim(),
    description: meta.description?.trim() || undefined,
    license: mapLicense(meta.license),
    tags: normalizeTags(meta.tags, meta.category),
    category: meta.category?.trim().toLowerCase() || undefined,
    sourceLicense: meta.license,
    sourcePopularity: normalizePopularity(meta.popularity),
  };
}
