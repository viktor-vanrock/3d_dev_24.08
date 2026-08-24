// Тонкий клиент плиты стола (MF-1094) поверх уже готового бэкенда очереди слайсинга (MF-1078)
// и ручного пикера профилей (slicerProfiles/route.ts::registerSlicerProfileList) — печатники и
// филаменты юзера уже отдаёт home/activation.ts::useActivation, здесь только то, чего там нет.
import type { SliceTrustPayload } from "./slicetrust.ts";
import type {
  PlateLayout,
  PlatePreflightResult,
  ProjectSliceSource,
  SliceIntent,
} from "@portal/contracts/jobs/slicer-plate";
import type { GetProjectManifestResult } from "@portal/contracts/http/models";

import { apiFetch } from "@shared/api";

export interface SlicerProfileOption {
  id: string;
  name: string;
  source_name: string;
  machine_id: string | null;
  material_id: string | null;
}

export async function listSlicerProfiles(profileClass: "machine" | "process" | "filament"): Promise<SlicerProfileOption[] | null> {
  const response = await apiFetch(`/slicer-profiles?class=${profileClass}`, { credentials: "include" });
  if (!response.ok) return null;
  const body = (await response.json()) as { profiles: SlicerProfileOption[] };
  return body.profiles;
}

export type SliceJobStatus = "queued" | "running" | "succeeded" | "failed";

export interface SliceJob {
  id: string;
  status: SliceJobStatus;
  error: string | null;
  error_code?: string | null;
  retryable?: boolean;
  metrics?: Record<string, unknown> | null;
  preflight?: PlatePreflightResult;
  preview_manifest_url?: string;
  gcode_url?: string;
}

export type CreateSliceJobPayload = SliceTrustPayload & {
  layout?: PlateLayout;
  intent?: SliceIntent;
};

export type CreateSliceJobResult =
  | { ok: true; job: SliceJob }
  | { ok: false; status: number; error: string };

interface ModelSearchResult {
  models?: Array<{ id?: string }>;
}

function fileBasename(value: string | undefined): string | null {
  if (!value) return null;
  try {
    return decodeURIComponent(new URL(value, window.location.origin).pathname.split("/").at(-1) ?? "");
  } catch {
    return value.split(/[/?#]/).filter(Boolean).at(-1) ?? null;
  }
}

/**
 * Резолвит code-first идентичность только из server-owned данных. Query нужен лишь для
 * получения короткого списка UUID-кандидатов; окончательное совпадение требует точных
 * artifact/step id внутри закреплённого манифеста. Front не хэширует Git-файлы и не доверяет
 * frontend-only фикстуре.
 */
export async function resolveProjectSliceSource({
  projectUid,
  artifactId,
  artifactPath,
  workflowStepId,
}: {
  projectUid: string;
  artifactId: string;
  artifactPath?: string;
  workflowStepId: string;
}): Promise<ProjectSliceSource | null> {
  try {
    const query = new URLSearchParams({ q: projectUid, limit: "20" });
    const searchResponse = await apiFetch(`/models?${query}`, { credentials: "include" });
    if (!searchResponse.ok) return null;
    const search = (await searchResponse.json()) as ModelSearchResult;
    const candidates = (search.models ?? []).flatMap((model) => (
      typeof model.id === "string" ? [model.id] : []
    ));

    const resolved = await Promise.all(candidates.map(async (modelId) => {
      const response = await apiFetch(`/models/${encodeURIComponent(modelId)}/manifest`, {
        credentials: "include",
      });
      if (!response.ok) return null;
      const manifest = (await response.json()) as GetProjectManifestResult;
      const configurationId = manifest.manifest.project["default-configuration"];
      const configuration = typeof configurationId === "string"
        ? manifest.manifest.configurations?.[configurationId]
        : null;
      const artifacts = Object.entries(manifest.manifest.artifacts ?? {});
      const expectedBasename = fileBasename(artifactPath);
      const artifactEntry = artifacts.find(([id]) => id === artifactId)
        ?? artifacts.find(([, candidate]) => (
          expectedBasename !== null && fileBasename(candidate.path ?? candidate.url) === expectedBasename
        ))
        ?? (
          configuration?.artifacts?.length === 1
            ? artifacts.find(([id]) => id === configuration.artifacts?.[0])
            : undefined
        );
      const workflow = configuration ? manifest.manifest.workflows?.[configuration.workflow] : null;
      const workflowStepIds = workflow
        ? [...new Set(Object.values(workflow.phases).flatMap((phase) => phase.steps))]
        : [];
      const resolvedWorkflowStepId = workflow?.steps?.[workflowStepId]
        ? workflowStepId
        : workflowStepIds.length === 1
          ? workflowStepIds[0]
          : workflowStepIds.find((id) => {
            const action = workflow?.steps?.[id]?.action;
            return action?.artifact === artifactEntry?.[0] || action?.artifact_id === artifactEntry?.[0];
          });
      if (
        typeof configurationId !== "string"
        || !configuration
        || !manifest.configuration_digest
        || !artifactEntry?.[1].sha256
        || !resolvedWorkflowStepId
      ) return null;

      return {
        uidMatches: manifest.manifest.project.uid === projectUid,
        source: {
          model_id: modelId,
          revision: manifest.head_sha,
          configuration_id: configurationId,
          configuration_digest: manifest.configuration_digest,
          workflow_step_id: resolvedWorkflowStepId,
          artifact_id: artifactEntry[0],
          artifact_sha256: artifactEntry[1].sha256,
        } satisfies ProjectSliceSource,
      };
    }));

    const matches = resolved.flatMap((candidate) => candidate ? [candidate] : []);
    return (matches.find((candidate) => candidate.uidMatches) ?? matches[0])?.source ?? null;
  } catch {
    return null;
  }
}

function sliceJobFromBody(body: Record<string, unknown>): SliceJob {
  return {
    id: body.id as string,
    status: body.status as SliceJobStatus,
    error: typeof body.error === "string" ? body.error : null,
    error_code: typeof body.error_code === "string" ? body.error_code : null,
    retryable: typeof body.retryable === "boolean" ? body.retryable : undefined,
    metrics: body.metrics && typeof body.metrics === "object" && !Array.isArray(body.metrics)
      ? body.metrics as Record<string, unknown>
      : null,
    preflight: body.preflight as PlatePreflightResult | undefined,
    preview_manifest_url: typeof body.preview_manifest_url === "string" ? body.preview_manifest_url : undefined,
    gcode_url: typeof body.gcode_url === "string" ? body.gcode_url : undefined,
  };
}

export async function createSliceJob(modelId: string, payload: CreateSliceJobPayload): Promise<CreateSliceJobResult> {
  try {
    const response = await apiFetch(`/models/${encodeURIComponent(modelId)}/slice`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (!response.ok) {
      return { ok: false, status: response.status, error: typeof body.error === "string" ? body.error : "request_failed" };
    }
    return { ok: true, job: sliceJobFromBody(body) };
  } catch {
    return { ok: false, status: 0, error: "network_error" };
  }
}

export async function getSliceJob(jobId: string): Promise<SliceJob | null> {
  const response = await apiFetch(`/slice-jobs/${encodeURIComponent(jobId)}`, { credentials: "include" });
  if (!response.ok) return null;
  return sliceJobFromBody((await response.json()) as Record<string, unknown>);
}
