// Клиент Make-галереи (MF-777, слайс Фазы 3 эпика MF-27): GET /makes (глобальная лента
// опубликованных Make, фильтры принтер/филамент/тег) + GET /makes/mine («Мои печати» в ЛК,
// apps/api/src/makes/list.ts+mine.ts). Публикация Make — multipart POST /makes: фото
// проходят mesh-пайплайн, а принтер и материалы сохраняют воспроизводимый контекст результата.
// Лидерборд «лучшая печать по модели» (MF-27 Ф3, apps/api/src/makes/leaderboard.ts) — тоже
// здесь: тот же MakeSummary-подобный контракт (avatar_config/avatar_snapshots, MF-1030).

import type { AvatarConfig, AvatarSnapshots } from "@shared/avatar";

export type MakeStatus = "draft" | "pending" | "published" | "hidden";
export const ISSUE_TAGS = ["warping", "stringing", "layer_shift", "adhesion"] as const;
export type IssueTag = (typeof ISSUE_TAGS)[number];

export const ISSUE_TAG_LABELS: Record<IssueTag, string> = {
  warping: "Варпинг",
  stringing: "Стрингинг",
  layer_shift: "Съезд слоёв",
  adhesion: "Адгезия",
};

export interface MakeSummary {
  id: string;
  model_id: string;
  model_title: string;
  author: {
    id: string;
    username: string;
    display_name: string | null;
    avatar_config: AvatarConfig | null;
    avatar_snapshots: AvatarSnapshots | null;
  };
  machine_id: string | null;
  machine_model: string | null;
  material_ids: string[];
  caption: string | null;
  printability_rating: number | null;
  // MF-1962: geometry_quality_rating — корректность геометрии/стыков МОДЕЛИ (проект),
  // surface_quality_rating — качество поверхности ЭТОГО конкретного отпечатка. Независимы от
  // printability_rating и друг от друга, не смешивать в UI (docs — см. contract.ts).
  geometry_quality_rating: number | null;
  surface_quality_rating: number | null;
  issue_tags: IssueTag[];
  status: MakeStatus;
  cover_photo_s3_key: string | null;
  likes_count: number;
  comments_count: number;
  reposts_count: number;
  views_count: number;
  created_at: string;
}

export interface ListMakesResult {
  items: MakeSummary[];
  next_cursor: string | null;
}

import { apiFetch, API_URL } from "@shared/api";

export interface ListMakesParams {
  modelId?: string;
  machineId?: string;
  materialId?: string;
  tag?: string;
  sort?: "new" | "popular";
  cursor?: string;
  limit?: number;
}

export async function listMakes(params: ListMakesParams = {}): Promise<ListMakesResult | null> {
  const query = new URLSearchParams();
  if (params.modelId) query.set("model_id", params.modelId);
  if (params.machineId) query.set("machine_id", params.machineId);
  if (params.materialId) query.set("material_id", params.materialId);
  if (params.tag) query.set("tag", params.tag);
  if (params.sort) query.set("sort", params.sort);
  if (params.cursor) query.set("cursor", params.cursor);
  if (params.limit) query.set("limit", String(params.limit));
  const qs = query.toString();
  const response = await apiFetch(`/makes${qs ? `?${qs}` : ""}`, { credentials: "include" });
  if (!response.ok) return null;
  return (await response.json()) as ListMakesResult;
}

export interface MakePhoto {
  id: string;
  position: number;
  is_cover: boolean;
  moderation_status: string;
}

export interface MakeDetail extends MakeSummary {
  notes: string | null;
  print_settings: Record<string, unknown>;
  materials: Array<{ id: string; name: string }>;
  photos: MakePhoto[];
  more_prints_of_model: MakeSummary[];
  same_material_prints: MakeSummary[];
}

export async function getMake(makeId: string): Promise<MakeDetail | null> {
  const response = await apiFetch(`/makes/${encodeURIComponent(makeId)}`, { credentials: "include" });
  if (!response.ok) return null;
  return (await response.json()) as MakeDetail;
}

export const getMakeDetail = getMake;

export function makePhotoUrl(makeId: string, photoId: string): string {
  return `${API_URL}/makes/${encodeURIComponent(makeId)}/photos/${encodeURIComponent(photoId)}`;
}

export interface CreateMakeInput {
  modelId: string;
  machineId: string;
  materialIds: string[];
  photos: File[];
  caption?: string;
  notes?: string;
  printabilityRating?: number;
  // MF-1962: geometryQualityRating — геометрия/стыки МОДЕЛИ (проект), surfaceQualityRating —
  // качество поверхности ЭТОГО конкретного отпечатка. Независимы от printabilityRating и друг
  // от друга — не выводить одно из другого.
  geometryQualityRating?: number;
  surfaceQualityRating?: number;
  issueTags?: IssueTag[];
  printSettings?: Record<string, string | number>;
}

export type CreateMakeResult = { ok: true; make: MakeSummary } | { ok: false; error: string };

export async function createMake(input: CreateMakeInput): Promise<CreateMakeResult> {
  const form = new FormData();
  form.set("model_id", input.modelId);
  form.set("machine_id", input.machineId);
  form.set("material_ids", input.materialIds.join(","));
  if (input.caption?.trim()) form.set("caption", input.caption.trim());
  if (input.notes?.trim()) form.set("notes", input.notes.trim());
  if (input.printabilityRating) form.set("printability_rating", String(input.printabilityRating));
  if (input.geometryQualityRating) form.set("geometry_quality_rating", String(input.geometryQualityRating));
  if (input.surfaceQualityRating) form.set("surface_quality_rating", String(input.surfaceQualityRating));
  if (input.issueTags?.length) form.set("issue_tags", input.issueTags.join(","));
  if (input.printSettings && Object.keys(input.printSettings).length > 0) {
    form.set("print_settings", JSON.stringify(input.printSettings));
  }
  for (const photo of input.photos) form.append("photos", photo);

  const response = await apiFetch(`/makes`, {
    method: "POST",
    credentials: "include",
    body: form,
  });
  const body = (await response.json().catch(() => ({}))) as MakeSummary & { error?: string };
  if (!response.ok) return { ok: false, error: body.error ?? "unknown" };
  return { ok: true, make: body };
}

// Совместимый низкоуровневый путь для старого мастера MF-1794: новый UI использует
// типизированный createMake выше, но отдельная Make-страница и её тесты остаются независимыми.
export async function createMakeFromForm(form: FormData): Promise<string | null> {
  const response = await apiFetch(`/makes`, {
    method: "POST",
    credentials: "include",
    body: form,
  });
  if (!response.ok) return null;
  const body = (await response.json()) as { make?: { id?: string }; id?: string };
  return body.make?.id ?? body.id ?? null;
}

export async function suggestMachine(raw: { vendor: string; model: string }): Promise<boolean> {
  const response = await apiFetch(`/machine-candidates`, {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(raw),
  });
  return response.ok;
}

export async function suggestMaterial(raw: { vendor: string; name: string }): Promise<boolean> {
  const response = await apiFetch(`/material-candidates`, {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(raw),
  });
  return response.ok;
}

export async function listMyMakes(params: { limit?: number; cursor?: string } = {}): Promise<ListMakesResult | null> {
  const query = new URLSearchParams();
  if (params.limit) query.set("limit", String(params.limit));
  if (params.cursor) query.set("cursor", params.cursor);
  const qs = query.toString();
  const response = await apiFetch(`/makes/mine${qs ? `?${qs}` : ""}`, { credentials: "include" });
  if (!response.ok) return null;
  return (await response.json()) as ListMakesResult;
}

// Справочники для фильтров галереи — тот же читающий каталог, что home/catalog.ts (MF-437),
// но без `q` (тут выпадающие списки, не автокомплит) — берём ограниченную первую страницу,
// каталог станков/филамента на этой фазе небольшой (тот же вердикт, что fetchPopularMaterials).
export interface FilterOption {
  id: string;
  label: string;
}

export async function listMachineOptions(): Promise<FilterOption[]> {
  const response = await apiFetch(`/machines?kind=fdm_printer&limit=100`, { credentials: "include" });
  if (!response.ok) return [];
  const data = (await response.json()) as { machines: Array<{ id: string; vendor: { name: string } | null; model: string }> };
  return data.machines.map((m) => ({ id: m.id, label: m.vendor?.name ? `${m.vendor.name} ${m.model}` : m.model }));
}

export async function listMaterialOptions(): Promise<FilterOption[]> {
  const response = await apiFetch(`/materials?kind=filament&limit=100`, { credentials: "include" });
  if (!response.ok) return [];
  const data = (await response.json()) as {
    materials: Array<{ id: string; name: string; vendor: { name: string }; material_type: { name: string } }>;
  };
  return data.materials.map((m) => ({ id: m.id, label: `${m.vendor.name} ${m.name} (${m.material_type.name})` }));
}

// Лидерборд «лучшая печать по модели» (apps/api/src/makes/leaderboard.ts) — GET /models/:id/
// makes/leaderboard, отсортирован по likes_count. avatar_url здесь — фото-аватарка юзера
// (users.avatar_url), не персонаж; avatar_config/avatar_snapshots — персонаж (MF-1030).
export interface MakeLeaderboardEntry {
  id: string;
  user_id: string;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
  avatar_config: AvatarConfig | null;
  avatar_snapshots: AvatarSnapshots | null;
  photo_s3_key?: string | null;
  caption: string | null;
  printability_rating: number | null;
  likes_count: number;
  comments_count: number;
  reposts_count: number;
  views_count: number;
  created_at: string;
}

export async function getMakeLeaderboard(modelId: string, limit = 10): Promise<MakeLeaderboardEntry[] | null> {
  const response = await apiFetch(`/models/${encodeURIComponent(modelId)}/makes/leaderboard?limit=${limit}`, {
    credentials: "include",
  });
  if (!response.ok) return null;
  const data = (await response.json()) as { items: MakeLeaderboardEntry[] };
  return data.items;
}
