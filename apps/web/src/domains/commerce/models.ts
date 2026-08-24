// Клиент Маркетплейса (MF-459/MF-463, docs/design/marketplace.v2.md): листинг галереи + поиск,
// детальная страница модели, редактирование/удаление, голосование, теги, профиль автора,
// загрузка исходника с прогрессом. XHR вместо fetch для загрузки — только XHR даёт upload.onprogress.
// Типы/интерфейсы — models.types.ts (MF-911: разбиение по функциональным секциям), ре-экспортированы
// отсюда же, чтобы импорты по всему market/ не менялись.

import type {
  AuxFile,
  AuxFileErrorCode,
  CatalogFacets,
  DescriptionImage,
  DescriptionImageErrorCode,
  ListModelsResult,
  ManufacturingMethod,
  MarketModel,
  ModelComboStat,
  ModelComment,
  ModelCommentAuthor,
  ModelCommentsResult,
  ModelDetail,
  ModelMakeStats,
  ModelOwner,
  ModelSort,
  ModelStatus,
  ProfileContact,
  ProjectFile,
  ProjectSummary,
  PublishStatus,
  RecommendedMaterial,
  RepoHistoryCommit,
  RepoTreeEntry,
  RepoTreeResult,
  RepoHistoryResult,
  SourceFormat,
  UploadErrorCode,
  UserProfile,
} from "./models.types.ts";

export type {
  AuxFile,
  AuxFileErrorCode,
  CatalogFacets,
  DescriptionImage,
  DescriptionImageErrorCode,
  ListModelsResult,
  ManufacturingMethod,
  MarketModel,
  ModelComboStat,
  ModelComment,
  ModelCommentAuthor,
  ModelCommentsResult,
  ModelDetail,
  ModelMakeStats,
  ModelOwner,
  ModelSort,
  ModelStatus,
  ProfileContact,
  ProjectFile,
  ProjectSummary,
  PublishStatus,
  RecommendedMaterial,
  RepoHistoryCommit,
  RepoTreeEntry,
  RepoTreeResult,
  RepoHistoryResult,
  SourceFormat,
  UploadErrorCode,
  UserProfile,
};
import { demoHistoryFor, demoModelFor, demoTreeFor } from "./demoproject.ts";
import type {
  GetProjectManifestResult,
  ProjectManifestError,
  PutProjectManifestRequest,
  PutProjectManifestResult,
} from "@portal/contracts/http/models";
import { apiFetch, API_URL, apiAssetUrl } from "@shared/api";

// Скачивание через временный <a>, а не window.open — так браузер не пытается открывать
// Content-Disposition:attachment ответы как поповер-вкладку (и не блокирует их как поп-ап).
// Общий примитив: и кнопки скачивания на странице модели (model.tsx), и доигрыш гостевого
// намерения после логина (guestresume.tsx) — один и тот же вызов, не два копипаста.
export function triggerBrowserDownload(url: string): void {
  const link = document.createElement("a");
  link.href = url;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
}

// Роли, отдаваемые общим эндпоинтом /models/:id/files/:role/download (MF-656, apps/api
// models/download.ts::AS_IS_DOWNLOAD_ROLES без служебного 'aux' — блок «Файлы проекта» его не
// показывает, projectfiles.tsx). 'canonical_3mf' скачивается отдельным /download.3mf
// (download_url), 'source' не отдаётся вовсе (docs/epics/3mf.storage.md) — оба сюда не входят.
export const ROLE_DOWNLOAD_ROLES = new Set(["cnc_program", "drawing", "gerber", "code_archive"]);

export function fileDownloadUrl(modelId: string, role: string): string {
  return apiAssetUrl(`/models/${encodeURIComponent(modelId)}/files/${encodeURIComponent(role)}/download`);
}

export async function getModelTree(id: string): Promise<RepoTreeResult | null> {
  const demo = demoTreeFor(id);
  if (demo) return demo;
  const response = await apiFetch(`/models/${encodeURIComponent(id)}/tree`, { credentials: "include" });
  if (!response.ok) return null;
  return (await response.json()) as RepoTreeResult;
}

export async function getModelHistory(id: string): Promise<RepoHistoryResult | null> {
  const demo = demoHistoryFor(id);
  if (demo) return demo;
  const response = await apiFetch(`/models/${encodeURIComponent(id)}/history`, { credentials: "include" });
  if (!response.ok) return null;
  return (await response.json()) as RepoHistoryResult;
}

export type PutProjectManifestOutcome =
  | { ok: true; value: PutProjectManifestResult }
  | { ok: false; conflict: true; currentHeadSha: string | null }
  | { ok: false; conflict: false };

export async function getProjectManifest(id: string): Promise<GetProjectManifestResult | null> {
  const response = await apiFetch(`/models/${encodeURIComponent(id)}/manifest`, { credentials: "include" });
  if (!response.ok) return null;
  return (await response.json()) as GetProjectManifestResult;
}

export async function putProjectManifest(id: string, request: PutProjectManifestRequest): Promise<PutProjectManifestOutcome> {
  const response = await apiFetch(`/models/${encodeURIComponent(id)}/manifest`, {
    method: "PUT",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });
  if (response.ok) return { ok: true, value: (await response.json()) as PutProjectManifestResult };
  if (response.status === 409) {
    const error = (await response.json()) as ProjectManifestError;
    if (error.error === "project_head_conflict") return { ok: false, conflict: true, currentHeadSha: error.current_head_sha };
  }
  return { ok: false, conflict: false };
}

export async function getModelComments(modelId: string): Promise<ModelCommentsResult | null> {
  const response = await apiFetch(`/models/${encodeURIComponent(modelId)}/comments`, { credentials: "include" });
  if (!response.ok) return null;
  return (await response.json()) as ModelCommentsResult;
}

export async function postModelComment(modelId: string, body: string, parentId?: string | null): Promise<ModelComment | null> {
  const response = await apiFetch(`/models/${encodeURIComponent(modelId)}/comments`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ body, parent_id: parentId ?? undefined }),
  });
  if (!response.ok) return null;
  return (await response.json()) as ModelComment;
}

export async function deleteModelComment(modelId: string, commentId: string): Promise<boolean> {
  const response = await apiFetch(`/models/${encodeURIComponent(modelId)}/comments/${encodeURIComponent(commentId)}`, {
    method: "DELETE",
    credentials: "include",
  });
  return response.ok;
}

// Форк проекта (docs/epics/project.git.md §3.4, docs/design/projects.page.md §11.4 — MF-522).
// Контракт GET-API/БД (server-side clone → forked_from) уже готов из MF-515/MF-516
// (git/repo.ts::forkRepo, models.forked_from), но сам POST-роут ещё не задеплоен Back'ом
// (нет в apps/api/src/models/repository.ts) — заявка зафиксирована в карточке MF-522.
// Вызов уже собран по контракту GAP-API §13 п.28 — заработает без правок Front, как только
// эндпоинт появится на проде.
export async function forkModel(id: string): Promise<{ id: string } | null> {
  const response = await apiFetch(`/models/${encodeURIComponent(id)}/fork`, {
    method: "POST",
    credentials: "include",
  });
  if (!response.ok) return null;
  const body = (await response.json()) as { model: { id: string } };
  return body.model;
}

export async function listModels(
  params: {
    limit?: number;
    cursor?: string;
    q?: string;
    sort?: ModelSort;
    tag?: string[];
    owner?: string;
    paid?: boolean;
    // Фасеты каталога (MF-1961, apps/api/src/models/list.ts): craft/source_format/
    // manufacturing_method — повторяемые (OR внутри размерности, AND между размерностями,
    // тот же приём, что tag). ams — тернарный (true/false/не задан = без фильтра).
    // compatibility: "mine" — требует сессию, фильтрует по реальному парку принтеров юзера.
    craft?: string[];
    sourceFormat?: SourceFormat[];
    manufacturingMethod?: ManufacturingMethod[];
    ams?: boolean;
    compatibility?: "mine";
  } = {},
): Promise<ListModelsResult | null> {
  const query = new URLSearchParams();
  if (params.limit) query.set("limit", String(params.limit));
  if (params.cursor) query.set("cursor", params.cursor);
  if (params.q) query.set("q", params.q);
  if (params.sort) query.set("sort", params.sort);
  if (params.owner) query.set("owner", params.owner);
  if (params.paid !== undefined) query.set("paid", params.paid ? "1" : "0");
  for (const tag of params.tag ?? []) query.append("tag", tag);
  for (const craft of params.craft ?? []) query.append("craft", craft);
  for (const sourceFormat of params.sourceFormat ?? []) query.append("source_format", sourceFormat);
  for (const method of params.manufacturingMethod ?? []) query.append("manufacturing_method", method);
  if (params.ams !== undefined) query.set("ams", params.ams ? "1" : "0");
  if (params.compatibility) query.set("compatibility", params.compatibility);
  const qs = query.toString();
  const response = await apiFetch(`/models${qs ? `?${qs}` : ""}`, { credentials: "include" });
  if (!response.ok) return null;
  return (await response.json()) as ListModelsResult;
}

// Hero-карусель «Проектов» (MF-512, docs/design/projects.page.md §2.6): кураторский featured-топ,
// не комбинируется с q/sort/tag (независим от поиска/каталога, §2.6) и не пагинируется (сервер
// сам ограничивает до 5 слайдов, apps/api/src/models/list.ts).
export async function listFeaturedModels(): Promise<MarketModel[] | null> {
  const response = await apiFetch(`/models?featured=1`, { credentials: "include" });
  if (!response.ok) return null;
  const body = (await response.json()) as ListModelsResult;
  return body.models;
}

export async function getModel(id: string): Promise<ModelDetail | null> {
  const demo = demoModelFor(id);
  if (demo) return demo;
  const response = await apiFetch(`/models/${encodeURIComponent(id)}`, { credentials: "include" });
  if (!response.ok) return null;
  const body = (await response.json()) as { model: ModelDetail };
  return body.model;
}

export async function updateModel(
  id: string,
  patch: {
    title?: string;
    description?: string;
    tags?: string[];
    repo_url?: string | null;
    recommended_material_id?: string | null;
    publish_status?: PublishStatus;
  },
): Promise<boolean> {
  const response = await apiFetch(`/models/${encodeURIComponent(id)}`, {
    method: "PATCH",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  return response.ok;
}

export async function deleteModel(id: string): Promise<boolean> {
  const response = await apiFetch(`/models/${encodeURIComponent(id)}`, {
    method: "DELETE",
    credentials: "include",
  });
  return response.ok;
}

export async function voteModel(
  id: string,
  value: -1 | 0 | 1,
): Promise<{ votes_up: number; votes_down: number; my_vote: -1 | 0 | 1 } | null> {
  const response = await apiFetch(`/models/${encodeURIComponent(id)}/vote`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ value }),
  });
  if (!response.ok) return null;
  return (await response.json()) as { votes_up: number; votes_down: number; my_vote: -1 | 0 | 1 };
}

export async function listTags(q?: string): Promise<string[]> {
  const query = q ? `?q=${encodeURIComponent(q)}` : "";
  const response = await apiFetch(`/tags${query}`, { credentials: "include" });
  if (!response.ok) return [];
  const body = (await response.json()) as { tags: string[] };
  return body.tags;
}

export interface TagWithCount {
  name: string;
  count: number;
}

// Список популярных запросов каталога: сервер исключает теги без публичных ready-проектов,
// поэтому кнопка не создаёт ложное пустое состояние.
export async function listTagsWithCounts(): Promise<TagWithCount[]> {
  const response = await apiFetch(`/tags?counts=1`, { credentials: "include" });
  if (!response.ok) return [];
  const body = (await response.json()) as { tags: TagWithCount[] };
  return body.tags;
}

export async function getUserProfile(username: string): Promise<UserProfile | null> {
  const response = await apiFetch(`/users/${encodeURIComponent(username)}`, { credentials: "include" });
  if (!response.ok) return null;
  const body = (await response.json()) as { user: UserProfile };
  return body.user;
}

// Кнопка «Подписаться» на storefront (MF-993) — follow/unfollow мастера по username.
export async function followUser(username: string): Promise<boolean> {
  const response = await apiFetch(`/users/${encodeURIComponent(username)}/follow`, {
    method: "POST",
    credentials: "include",
  });
  return response.ok;
}

export async function unfollowUser(username: string): Promise<boolean> {
  const response = await apiFetch(`/users/${encodeURIComponent(username)}/follow`, {
    method: "DELETE",
    credentials: "include",
  });
  return response.ok;
}

export class UploadError extends Error {
  code: UploadErrorCode;
  constructor(code: UploadErrorCode, message?: string) {
    super(message ?? code);
    this.code = code;
  }
}

// XHR (не fetch) — нужен xhr.upload.onprogress для полосы прогресса в AddModelFlow.
export function uploadModel(
  file: File,
  fields: { title: string; description: string; tags?: string[]; repo_url?: string },
  onProgress?: (fraction: number) => void,
): Promise<MarketModel> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${API_URL}/models`);
    xhr.withCredentials = true;
    xhr.upload.onprogress = (event) => {
      if (onProgress && event.lengthComputable) onProgress(event.loaded / event.total);
    };
    xhr.onload = () => {
      let body: unknown = null;
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        body = null;
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve((body as { model: MarketModel }).model);
        return;
      }
      const code = (body as { error?: string } | null)?.error;
      if (
        code === "UNSUPPORTED_FORMAT" ||
        code === "FORMAT_MISMATCH" ||
        code === "FILE_TOO_LARGE" ||
        code === "DECOMPRESSION_LIMIT" ||
        code === "INVALID_REPO_URL" ||
        code === "storage_not_configured" ||
        code === "unauthorized"
      ) {
        reject(new UploadError(code));
      } else {
        reject(new UploadError("unknown"));
      }
    };
    xhr.onerror = () => reject(new UploadError("network"));
    const form = new FormData();
    form.append("title", fields.title);
    if (fields.description) form.append("description", fields.description);
    if (fields.tags && fields.tags.length > 0) form.append("tags", fields.tags.join(","));
    if (fields.repo_url) form.append("repo_url", fields.repo_url);
    form.append("file", file);
    xhr.send(form);
  });
}

export class DescriptionImageError extends Error {
  code: DescriptionImageErrorCode;
  constructor(code: DescriptionImageErrorCode, message?: string) {
    super(message ?? code);
    this.code = code;
  }
}

export async function uploadDescriptionImage(modelId: string, file: File): Promise<DescriptionImage> {
  const form = new FormData();
  form.append("file", file);
  let response: Response;
  try {
    response = await apiFetch(`/models/${encodeURIComponent(modelId)}/description-images`, {
      method: "POST",
      credentials: "include",
      body: form,
    });
  } catch {
    throw new DescriptionImageError("network");
  }
  if (!response.ok) {
    let code: string | undefined;
    try {
      code = ((await response.json()) as { error?: string } | null)?.error;
    } catch {
      code = undefined;
    }
    if (
      code === "DESCRIPTION_TOO_MANY_IMAGES" ||
      code === "FILE_TOO_LARGE" ||
      code === "UNSUPPORTED_IMAGE_FORMAT" ||
      code === "storage_not_configured" ||
      code === "unauthorized"
    ) {
      throw new DescriptionImageError(code);
    }
    throw new DescriptionImageError("unknown");
  }
  const body = (await response.json()) as { file: DescriptionImage };
  return body.file;
}

export class AuxFileError extends Error {
  code: AuxFileErrorCode;
  constructor(code: AuxFileErrorCode, message?: string) {
    super(message ?? code);
    this.code = code;
  }
}

const AUX_FILE_ERROR_CODES = new Set<string>([
  "FILENAME_REQUIRED",
  "EMPTY_FILE",
  "FILE_TOO_LARGE",
  "FILENAME_CONFLICT",
  "REPO_NOT_READY",
  "REPO_TOO_LARGE",
  "unauthorized",
  "forbidden",
  "not_found",
]);

async function readErrorCode(response: Response): Promise<string | undefined> {
  try {
    return ((await response.json()) as { error?: string } | null)?.error;
  } catch {
    return undefined;
  }
}

export async function uploadAuxFile(modelId: string, file: File): Promise<AuxFile> {
  const form = new FormData();
  form.append("file", file);
  let response: Response;
  try {
    response = await apiFetch(`/models/${encodeURIComponent(modelId)}/files`, {
      method: "POST",
      credentials: "include",
      body: form,
    });
  } catch {
    throw new AuxFileError("network");
  }
  if (!response.ok) {
    const code = await readErrorCode(response);
    if (code && AUX_FILE_ERROR_CODES.has(code)) throw new AuxFileError(code as AuxFileErrorCode);
    throw new AuxFileError("unknown");
  }
  const body = (await response.json()) as { file: AuxFile };
  return body.file;
}

export async function deleteAuxFile(modelId: string, fileId: string): Promise<boolean> {
  const response = await apiFetch(
    `/models/${encodeURIComponent(modelId)}/files/${encodeURIComponent(fileId)}`,
    { method: "DELETE", credentials: "include" },
  );
  return response.ok;
}
