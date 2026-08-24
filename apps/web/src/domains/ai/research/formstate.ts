// Состояние формы /research/<slug> (MF-917) — один плоский объект, сериализуемый в draft.ts и
// собираемый в payload POST /research/printers (см. buildSavePayload в researchform.tsx).
//
// Три состояния SchemaField (§2.5) живут на уровне leaf-поля: `notFound` — осознанная галка
// «не нашёл», `sourceIndex` — ручной оверрайд сноски (null = «берём последний активный источник»,
// §2.6 автоцепление). Значение и notFound взаимоисключающи — setLeafValue снимает notFound и
// наоборот (форма гарантирует это в редьюсере, не в компоненте).

import { deriveSlug } from "./schema.ts";
import type { PrinterRecord } from "./api.ts";

export interface LeafField {
  value: string;
  notFound: boolean;
  sourceIndex: number | null;
}

export const EMPTY_LEAF: LeafField = { value: "", notFound: false, sourceIndex: null };

export interface ToolheadExtraRow {
  kind: string;
  spec: string;
}

export interface PhotoItem {
  key: string;
  status: "uploading" | "done" | "error";
  progress: number;
}

export interface FormState {
  brand: string;
  model: string;
  slugOverride: string | null; // null = авто из brand/model
  aliases: string[];
  status: string;
  releasedAt: string;
  kinematics: string;
  printerType: string;
  enclosed: string; // "" | "true" | "false" — плоский tri-state без SchemaField-семантики
  fields: Record<string, LeafField>; // dotted path → "hotend.max_temp_c" и т.п.
  materialsSupported: string[];
  uniqueFeatures: string[];
  toolheadExtras: ToolheadExtraRow[];
  photos: PhotoItem[];
  heroKey: string | null;
  sources: string[];
  activeSourceIndex: number | null;
  confidence: "high" | "medium" | "low" | "";
  baseUpdatedAt: string | null; // _meta.updated_at карточки на момент загрузки — для конфликт-детекта
  filledBy: string | null;
  existingGaps: string[];
}

export function emptyFormState(): FormState {
  return {
    brand: "",
    model: "",
    slugOverride: null,
    aliases: [],
    status: "announced",
    releasedAt: "",
    kinematics: "",
    printerType: "",
    enclosed: "",
    fields: {},
    materialsSupported: [],
    uniqueFeatures: [],
    toolheadExtras: [],
    photos: [],
    heroKey: null,
    sources: [],
    activeSourceIndex: null,
    confidence: "",
    baseUpdatedAt: null,
    filledBy: null,
    existingGaps: [],
  };
}

export function currentSlug(state: FormState): string {
  if (state.slugOverride) return state.slugOverride;
  return deriveSlug(state.brand, state.model);
}

function scalarToText(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value);
}

// Разворачивает PrinterRecord (ответ API) в FormState для редактирования — обратная операция
// buildSavePayload. Существующие значения приходят БЕЗ notFound/sourceIndex (провенанс есть
// отдельно в field_sources, но это ссылка на прошлый sources[] — здесь просто заполнено/пусто).
export function formStateFromPrinter(printer: PrinterRecord): FormState {
  const state = emptyFormState();
  state.brand = printer.brand;
  state.model = printer.model;
  state.slugOverride = printer.slug;
  state.aliases = printer.aliases;
  state.status = printer.status;
  state.releasedAt = printer.released_at ?? "";
  state.kinematics = printer.kinematics ?? "";
  state.printerType = printer.type ?? "";
  state.enclosed = printer.enclosed === null ? "" : printer.enclosed ? "true" : "false";
  state.materialsSupported = printer.materials_supported ?? [];
  state.uniqueFeatures = printer.unique_features ?? [];
  state.toolheadExtras = printer.toolhead_extras ?? [];
  state.heroKey = (printer.media as { hero?: string | null })?.hero ?? null;
  state.photos = ((printer.media as { gallery?: string[] })?.gallery ?? []).map((key) => ({ key, status: "done", progress: 1 }));
  state.sources = printer.sources ?? [];
  state.confidence = (printer._meta.confidence as FormState["confidence"]) ?? "";
  state.baseUpdatedAt = printer._meta.updated_at;
  state.filledBy = printer._meta.filled_by;
  state.existingGaps = printer._meta.gaps ?? [];

  const sections: [string, Record<string, unknown> | null][] = [
    ["build_volume", printer.build_volume],
    ["hotend", printer.hotend],
    ["bed", printer.bed],
    ["speed", printer.speed],
    ["multimaterial", printer.multimaterial],
    ["connectivity", printer.connectivity],
    ["dimensions_mm", printer.dimensions_mm],
    ["price", printer.price],
  ];
  for (const [sectionKey, section] of sections) {
    if (!section) continue;
    for (const [leafKey, value] of Object.entries(section)) {
      if (value === null || value === undefined) continue;
      const path = `${sectionKey}.${leafKey}`;
      const sourceUrl = printer.field_sources[path]?.source_url;
      const sourceIndex = sourceUrl ? state.sources.indexOf(sourceUrl) : -1;
      state.fields[path] = { value: scalarToText(value), notFound: false, sourceIndex: sourceIndex >= 0 ? sourceIndex : null };
    }
  }
  return state;
}
