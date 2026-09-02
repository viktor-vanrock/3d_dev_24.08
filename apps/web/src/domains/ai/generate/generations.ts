// Клиент «Генерации по тексту» (MF-353 Фаза 3, MF-659). Контракт — apps/api/src/generations/contract.ts:
// POST/GET /generations, GET /generations/:id, ветки openscad(STL)/kzd(PNG)/hueforge(zip+PNG-превью)/
// trellis(STL+GLB-превью, если меш watertight — иначе только GLB, MF-2001).

import { apiFetch, API_URL } from "@shared/api";

// Живая находка 2026-07-20: trellis (MF-2001) был добавлен на бэкенде (apps/api/src/generations/
// contract.ts::GENERATION_BRANCHES), но этот массив не обновили — GenerationBranch здесь и там
// разошлись. Раз тип строился по ЭТОМУ (неполному) массиву, TS не ловил на сборке, что реальный
// `generation.branch` с сервера может прийти как "trellis"; в рантайме generatescreen.tsx падал
// на `BRANCH_META[generation.branch].icon` для истории с trellis-генерацией (TypeError: Cannot
// read properties of undefined) — не гипотетически, воспроизведено вживую на dev.3mf.tech.
export const GENERATION_BRANCHES = ["openscad", "kzd", "hueforge", "trellis", "rudalle"] as const;
export type CreatableGenerationBranch = (typeof GENERATION_BRANCHES)[number];
export type GenerationBranch = CreatableGenerationBranch | "concepts";

export type GenerationStatus = "queued" | "running" | "done" | "error" | "timed_out";
export type GenerationErrorCode = "timeout" | "provider_error" | null;
export type GenerationPhase =
  | "queued"
  | "loading"
  | "draft"
  | "geometry"
  | "validation"
  | "export";

export interface Generation {
  id: string;
  branch: GenerationBranch;
  prompt: string;
  params: Record<string, unknown>;
  status: GenerationStatus;
  preview_url: string | null;
  artifact_url: string | null;
  error: string | null;
  error_code: GenerationErrorCode;
  retryable?: boolean | null;
  delayed?: boolean | null;
  preview_shots?: Array<{ angle: "front" | "three_quarter" | "back"; url: string }> | null;
  source_generation_id?: string | null;
  source_angles?: Array<"front" | "three_quarter" | "back"> | null;
  created_at: string;
  updated_at: string;
  // Backwards-compatible поля будущего job-контракта MF-1999/MF-2001.
  // Старый API их не возвращает — мастерская показывает честный диапазон,
  // а не выдумывает точную позицию или процент.
  queue_position?: number | null;
  eta_seconds?: number | null;
  estimate_updated_at?: string | null;
  progress?: number | null;
  phase?: GenerationPhase | null;
}

interface WireGeneration extends Omit<Generation, "progress" | "phase" | "eta_seconds"> {
  progress?:
    | number
    | {
        phase: GenerationPhase;
        progress: number | null;
        eta_seconds: number | null;
        estimate_updated_at?: string | null;
      }
    | null;
  phase?: GenerationPhase | null;
  eta_seconds?: number | null;
}

// Коды создания (create.ts): 422 валидация/модерация, 413 лимиты размера, 429 квоты.
export type CreateGenerationErrorCode =
  | "INVALID_BRANCH"
  | "PROMPT_REQUIRED"
  | "PROMPT_TOO_LONG"
  | "PROMPT_NOT_ALLOWED"
  | "INVALID_PARAMS"
  | "PARAMS_TOO_LARGE"
  | "RATE_LIMITED"
  | "NETWORK";

export interface CreateGenerationError {
  code: CreateGenerationErrorCode;
  scope?: "hour" | "day";
  limit?: number;
}

export type CreateGenerationResult = { generation: Generation } | { error: CreateGenerationError };

export async function createGeneration(input: {
  branch: CreatableGenerationBranch;
  prompt: string;
  params?: Record<string, unknown>;
  source_generation_id?: string;
  source_angles?: Array<"front" | "three_quarter" | "back">;
  idempotencyKey?: string;
}): Promise<CreateGenerationResult> {
  let response: Response;
  try {
    response = await apiFetch(`/generations`, {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        ...(input.idempotencyKey ? { "Idempotency-Key": input.idempotencyKey } : {}),
      },
      body: JSON.stringify({
        branch: input.branch,
        prompt: input.prompt,
        params: input.params,
        source_generation_id: input.source_generation_id,
        source_angles: input.source_angles,
      }),
    });
  } catch {
    return { error: { code: "NETWORK" } };
  }
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string; scope?: "hour" | "day"; limit?: number } | null;
    return { error: { code: (body?.error as CreateGenerationErrorCode) ?? "NETWORK", scope: body?.scope, limit: body?.limit } };
  }
  const body = (await response.json()) as { generation: WireGeneration };
  return { generation: parseGeneration(body.generation) };
}

export interface GeneratedConcept {
  id: string;
  generation_id: string;
  normalized_query: string;
  label: string;
  prompt: string;
  motif: string | null;
  reuse_count: number;
  status: "queued" | "running" | "ready" | "failed";
  preview_url: string | null;
}

export type CreateConceptGenerationResult =
  | { concept: GeneratedConcept; generation: Generation | null; cached: boolean }
  | { error: CreateGenerationError };

export async function createConceptGeneration(input: {
  query: string;
  label: string;
  prompt: string;
  motif?: string;
  idempotencyKey?: string;
}): Promise<CreateConceptGenerationResult> {
  let response: Response;
  try {
    response = await apiFetch(`/generations/concepts`, {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        ...(input.idempotencyKey ? { "Idempotency-Key": input.idempotencyKey } : {}),
      },
      body: JSON.stringify({
        query: input.query,
        label: input.label,
        prompt: input.prompt,
        motif: input.motif,
      }),
    });
  } catch {
    return { error: { code: "NETWORK" } };
  }
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string; scope?: "hour" | "day"; limit?: number } | null;
    return { error: { code: (body?.error as CreateGenerationErrorCode) ?? "NETWORK", scope: body?.scope, limit: body?.limit } };
  }
  const body = (await response.json()) as {
    concept: GeneratedConcept;
    generation?: WireGeneration;
    cached?: boolean;
  };
  return {
    concept: body.concept,
    generation: body.generation ? parseGeneration(body.generation) : null,
    cached: body.cached === true,
  };
}

function parseGeneration(generation: WireGeneration): Generation {
  const snapshot =
    generation.progress && typeof generation.progress === "object"
      ? generation.progress
      : null;
  const numericProgress = typeof generation.progress === "number" ? generation.progress : null;
  return {
    ...generation,
    progress: snapshot ? snapshot.progress : numericProgress,
    phase: snapshot ? snapshot.phase : (generation.phase ?? null),
    eta_seconds: snapshot ? snapshot.eta_seconds : (generation.eta_seconds ?? null),
    estimate_updated_at: snapshot
      ? (snapshot.estimate_updated_at ?? null)
      : (generation.estimate_updated_at ?? null),
  };
}

export async function getGeneration(id: string): Promise<Generation | null> {
  try {
    const response = await apiFetch(`/generations/${encodeURIComponent(id)}`, { credentials: "include" });
    if (!response.ok) return null;
    const body = (await response.json()) as { generation: WireGeneration };
    return parseGeneration(body.generation);
  } catch {
    // Потеря сети не должна убивать polling: мастерская восстановит статус,
    // когда соединение вернётся.
    return null;
  }
}

export async function listGenerations(): Promise<Generation[] | null> {
  const response = await apiFetch(`/generations`, { credentials: "include" });
  if (!response.ok) return null;
  const body = (await response.json()) as { generations: WireGeneration[] };
  return body.generations.map(parseGeneration);
}

// preview_url/artifact_url — API-прокси пути (не абсолютные), тот же приём, что apiAssetUrl у models.ts.
export function apiAssetUrl(path: string): string {
  return /^https?:\/\//.test(path) ? path : `${API_URL}${path}`;
}

// MF-660: «Создать карточку» — сохранить готовую генерацию в черновик каталога.
// apps/api/src/generations/catalog-draft.ts POST /generations/:id/catalog-draft.
export type CreateCatalogDraftResult = { modelId: string } | { error: "UNSUPPORTED_FORMAT" | "FAILED" | "NETWORK" };

export async function createCatalogDraft(generationId: string): Promise<CreateCatalogDraftResult> {
  let response: Response;
  try {
    response = await apiFetch(`/generations/${encodeURIComponent(generationId)}/catalog-draft`, {
      method: "POST",
      credentials: "include",
    });
  } catch {
    return { error: "NETWORK" };
  }
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    return { error: body?.error === "UNSUPPORTED_FORMAT" ? "UNSUPPORTED_FORMAT" : "FAILED" };
  }
  const body = (await response.json()) as { model: { id: string } };
  return { modelId: body.model.id };
}
