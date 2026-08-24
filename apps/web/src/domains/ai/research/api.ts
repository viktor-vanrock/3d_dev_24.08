import type { FirmwarePilotStatus } from "@portal/contracts/http/devices";
import type { ResearchScope } from "../../../router.ts";

// Клиент /research/* — очередь (MF-916) + форма карточки (MF-917), docs/design/research.workbench.md.
// Тот же приём fetch+credentials:"include", что market/models.ts — без обёртки-интерцептора,
// каждый вызывающий код сам решает, что делать с конкретным статусом.
import { apiFetch, API_URL } from "@shared/api";

export type ResearchStatus = "announced" | "shipping" | "eol" | "rumored";
export type ResearchConfidence = "high" | "medium" | "low";

// Короткий набор фасетов, которым кормится каталог (§1.4/§8.2 спеки) — ровно 7 полей,
// не все 60+ схемы. Полнота карточки в очереди считается по нему, не по секциям формы.
export const QUEUE_FACET_COUNT = 7;

export interface ResearchQueueItem {
  slug: string;
  brand: string;
  model: string;
  status: ResearchStatus;
  filled_count: number; // 0..QUEUE_FACET_COUNT
  confidence: ResearchConfidence | null;
  filled_by: string | null;
  filled_by_kind: "agent" | "human" | null;
  updated_at: string | null; // ISO
  flagged: boolean; // есть репорт неточности пользователя (§1.4 «Помечено пользователями»)
}

export interface ResearchSearchHit {
  slug: string;
  brand: string;
  model: string;
  status: ResearchStatus;
}

async function getJson<T>(path: string, signal?: AbortSignal): Promise<T | null> {
  try {
    const response = await apiFetch(`${path}`, { credentials: "include", signal });
    if (!response.ok) return null;
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

// `GET /research/printers` (листинг очереди/поиск, `?scope=`/`?q=`) ещё не задеплоен на бэкенде
// (воркстрим Fullstack/Back, MF-839 п.3) — пишем вызов против ожидаемой формы (printer.schema.json +
// §1.4/§8.2) и мягко деградируем в пустой/error UI на 404/сеть, тот же приём, что src/feed/api.ts.
// Когда бэкенд появится — меняются только тела функций ниже, не вызывающий код экрана.
export async function listResearchQueue(scope: ResearchScope, signal?: AbortSignal): Promise<ResearchQueueItem[] | null> {
  const data = await getJson<{ items: ResearchQueueItem[] }>(`/research/printers?scope=${scope}`, signal);
  return data?.items ?? null;
}

// Живая выдача поиска-создания (§1.3): brand/model/aliases/slug. Пустой запрос сюда не доходит —
// экран не рисует панель на пустом вводе.
export async function searchResearchPrinters(query: string, signal?: AbortSignal): Promise<ResearchSearchHit[] | null> {
  const data = await getJson<{ items: ResearchSearchHit[] }>(`/research/printers?q=${encodeURIComponent(query)}`, signal);
  return data?.items ?? null;
}

export interface FieldProvenanceEntry {
  source_url: string | null;
  filled_by: string;
  ts: string;
  confidence: string;
}

export type FieldSources = Record<string, FieldProvenanceEntry>;

// Форма как её отдаёт serializePrinter (apps/api/src/printers/serialize.ts) — секции спек
// развёрнуты, не намёка на facet-колонки/jsonb под капотом.
// pilot_status типизирован строго через FirmwarePilotStatus (а не PrinterPilotStatusDto с stage?: string),
// так как pilotInfoFor (firmwarepilot.ts) требует точный discriminated union.
export interface PrinterRecord {
  pilot_status?: FirmwarePilotStatus;
  id: string;
  slug: string;
  brand: string;
  model: string;
  aliases: string[];
  released_at: string | null;
  status: string;
  kinematics: string | null;
  type: string | null;
  enclosed: boolean | null;
  build_volume: Record<string, unknown>;
  hotend: Record<string, unknown>;
  bed: Record<string, unknown>;
  speed: Record<string, unknown> | null;
  multimaterial: Record<string, unknown>;
  toolhead_extras: { kind: string; spec: string }[];
  connectivity: Record<string, unknown>;
  materials_supported: string[];
  dimensions_mm: Record<string, unknown> | null;
  price: Record<string, unknown>;
  unique_features: string[];
  support_level: string | null;
  firmware_ready: boolean | null;
  firmware_public: boolean | null;
  connector_type: string | null;
  media: { hero?: string | null; gallery?: string[]; official_url?: string | null };
  sources: string[];
  field_sources: FieldSources;
  _meta: {
    schema_version: string;
    filled_by: string | null;
    reviewed_by: string | null;
    confidence: string | null;
    gaps: string[];
    verified: boolean;
    updated_at: string;
  };
}

export interface FieldError {
  field: string;
  message: string;
}

export interface SaveConflict {
  field: string;
  ours: unknown;
  theirs: unknown;
}

export type SaveResult =
  | { kind: "ok"; printer: PrinterRecord; conflicts: SaveConflict[]; draft: boolean }
  | { kind: "validation_error"; fields: FieldError[] }
  | { kind: "unauthorized" }
  | { kind: "forbidden" }
  | { kind: "network_error" };

export type FetchResult =
  | { kind: "ok"; printer: PrinterRecord }
  | { kind: "not_found" }
  | { kind: "unauthorized" }
  | { kind: "forbidden" }
  | { kind: "network_error" };

// Публичный каталог `GET /printers` (2026-07-21) — в отличие от fetchPrinterBySlug выше
// (/research/printers/:slug, требует роль researcher и отдаёт черновики), этот путь гостевой
// и отдаёт только опубликованные карточки (backend: cardinality(sources) > 0). Курсор пагинирует
// ответ (лимит 100/страница) — сегодня в каталоге ~20 карточек, но код идёт по next_cursor до
// конца, а не молча берёт только первую страницу.
export async function listPrinters(): Promise<PrinterRecord[]> {
  const all: PrinterRecord[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < 50; page += 1) {
    const path: string = cursor ? `/printers?limit=100&cursor=${encodeURIComponent(cursor)}` : "/printers?limit=100";
    const data: { printers: PrinterRecord[]; has_more: boolean; next_cursor: string | null } | null = await getJson(path);
    if (!data) break;
    all.push(...data.printers);
    if (!data.has_more || !data.next_cursor) break;
    cursor = data.next_cursor;
  }
  return all;
}

export async function fetchPrinterBySlug(slug: string): Promise<FetchResult> {
  try {
    const response = await apiFetch(`/research/printers/${encodeURIComponent(slug)}`, { credentials: "include" });
    if (response.status === 401) return { kind: "unauthorized" };
    if (response.status === 403) return { kind: "forbidden" };
    if (response.status === 404) return { kind: "not_found" };
    if (!response.ok) return { kind: "network_error" };
    const data = (await response.json()) as { printer: PrinterRecord };
    return { kind: "ok", printer: data.printer };
  } catch {
    return { kind: "network_error" };
  }
}

export async function savePrinterCard(payload: Record<string, unknown>): Promise<SaveResult> {
  try {
    const response = await apiFetch(`/research/printers`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (response.status === 401) return { kind: "unauthorized" };
    if (response.status === 403) return { kind: "forbidden" };
    if (response.status === 422) {
      const data = (await response.json()) as { fields: FieldError[] };
      return { kind: "validation_error", fields: data.fields };
    }
    if (!response.ok) return { kind: "network_error" };
    const data = (await response.json()) as { printer: PrinterRecord; conflicts: SaveConflict[]; draft: boolean };
    return { kind: "ok", printer: data.printer, conflicts: data.conflicts, draft: data.draft };
  } catch {
    return { kind: "network_error" };
  }
}

export interface PresignResult {
  uploadUrl: string;
  key: string;
}

// Presigned PUT (§2.4) — фото льётся напрямую в S3, минуя наш сервер. Пока ручка/бакет ещё не
// на всех окружениях (docs/infra/readme.md § «Бакет №5», Domain name — блокер MF-715) — вызывающий
// код (photosection.tsx) трактует любую не-2xx ветку как «загрузка временно недоступна», не крашится.
export async function presignPrinterPhoto(slug: string, contentType: string): Promise<PresignResult | null> {
  try {
    const response = await apiFetch(`/research/printers/media/presign`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slug, content_type: contentType }),
    });
    if (!response.ok) return null;
    const data = (await response.json()) as { upload_url: string; key: string };
    return { uploadUrl: data.upload_url, key: data.key };
  } catch {
    return null;
  }
}

export async function uploadPrinterPhoto(uploadUrl: string, file: File): Promise<boolean> {
  try {
    // Прямой PUT на presigned S3 URL — не наш API, apiFetch не используется намеренно
    const response = await fetch(uploadUrl, { method: "PUT", body: file, headers: { "Content-Type": file.type } });
    return response.ok;
  } catch {
    return false;
  }
}

// Превью фото — та же presigned-GET-редирект ручка, что раздача (см. research.route.ts), пока
// bucket не получил публичный Domain name.
export function printerMediaUrl(key: string): string {
  return `${API_URL}/research/media/${key}`;
}