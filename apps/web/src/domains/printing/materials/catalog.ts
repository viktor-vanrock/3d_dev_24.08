import { apiFetch } from "@shared/api";
import type { components } from "../../../api/generated/openapi";

export const MATERIAL_KINDS = ["filament", "resin", "plywood", "aluminum"] as const;
export type MaterialKind = (typeof MATERIAL_KINDS)[number];

// Типы ответа API — алиасы на сгенерированные схемы
export type MaterialRecord = components["schemas"]["CatalogMaterialDto"];
export type MaterialPage = components["schemas"]["CatalogMaterialsDto"];

export interface MaterialFilters {
  q: string;
  vendor: string;
  type: string;
  kind: MaterialKind | "";
  color: string;
}

export const MATERIAL_PAGE_SIZE = 24;

const COLOR_ALIASES: Record<string, string> = {
  "чёрный": "black",
  "черный": "black",
  "белый": "white",
  "красный": "red",
  "синий": "blue",
  "голубой": "blue",
  "зелёный": "green",
  "зеленый": "green",
  "жёлтый": "yellow",
  "желтый": "yellow",
  "серый": "gray",
  "серебристый": "silver",
};

export function materialSearchTerm(value: string): string {
  const trimmed = value.trim();
  return COLOR_ALIASES[trimmed.toLocaleLowerCase("ru-RU")] ?? trimmed;
}

export function emptyMaterialFilters(): MaterialFilters {
  return { q: "", vendor: "", type: "", kind: "", color: "" };
}

function validKind(value: string | null): MaterialKind | "" {
  return value && (MATERIAL_KINDS as readonly string[]).includes(value) ? (value as MaterialKind) : "";
}

function positiveOffset(value: string | null): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
}

export function parseMaterialFilters(search: string): MaterialFilters & { offset: number } {
  const params = new URLSearchParams(search);
  return {
    q: (params.get("q") ?? "").slice(0, 200),
    vendor: params.get("vendor") ?? "",
    type: params.get("type") ?? "",
    kind: validKind(params.get("kind")),
    color: params.get("color") ?? "",
    offset: positiveOffset(params.get("offset")),
  };
}

export function materialFiltersToSearch(filters: MaterialFilters, offset = 0): string {
  const params = new URLSearchParams();
  // materialSearchTerm — только для выделенного поля ЦВЕТ: q бьёт по name/vendor/type/color
  // сразу (materials.ts backend), подмена русского слова английским здесь ломала бы поиск по
  // остальным полям, если пользователь просто искал бренд/линейку, совпавшую с цветом (MF-1888).
  if (filters.q.trim()) params.set("q", filters.q.trim().slice(0, 200));
  if (filters.vendor.trim()) params.set("vendor", filters.vendor.trim());
  if (filters.type.trim()) params.set("type", filters.type.trim());
  if (filters.kind) params.set("kind", filters.kind);
  if (filters.color.trim()) params.set("color", materialSearchTerm(filters.color));
  if (offset > 0) params.set("offset", String(offset));
  const query = params.toString();
  return query ? `?${query}` : "";
}

function requestSearch(filters: MaterialFilters, offset: number): string {
  const params = new URLSearchParams(materialFiltersToSearch(filters, offset));
  params.set("limit", String(MATERIAL_PAGE_SIZE));
  if (offset === 0) params.delete("offset");
  return params.toString();
}

export async function fetchMaterialPage(filters: MaterialFilters, offset: number, signal?: AbortSignal): Promise<MaterialPage> {
  const response = await apiFetch(`/materials?${requestSearch(filters, offset)}`, {
    credentials: "include",
    signal,
  });
  if (!response.ok) throw new Error(`materials request failed: ${response.status}`);
  return (await response.json()) as components["schemas"]["CatalogMaterialsDto"];
}

export function hasMaterialFilters(filters: MaterialFilters): boolean {
  return Boolean(filters.q || filters.vendor || filters.type || filters.kind || filters.color);
}

export function kindLabel(kind: MaterialKind): string {
  return { filament: "Филамент", resin: "Смола", plywood: "Фанера", aluminum: "Алюминий" }[kind];
}