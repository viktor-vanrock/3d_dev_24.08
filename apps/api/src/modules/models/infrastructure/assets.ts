import { pool } from "../../../db/client.ts";
import { PROJECT_FILE_ROLES } from "./formats.ts";

// Пути к API-прокси ассетов превью (MF-470, docs/epics/marketplace.md §1 п.13): вместо presigned
// URL на MinIO отдаём собственный путь API — стримит ../models/asset.ts. Используется и в
// list.ts (миниатюра галереи), и в detail.ts (постер + GLB-вьюер страницы модели).

export function previewAssetUrl(modelId: string): string {
  return `/models/${modelId}/preview.glb`;
}

export function thumbAssetUrl(modelId: string): string {
  return `/models/${modelId}/thumb.webp`;
}

// MF-433/MF-748: облегчённый GLB мобильного профиля вьюера (~30k tri/≤1.5МБ), role='mobile_preview'.
export function previewMobileAssetUrl(modelId: string): string {
  return `/models/${modelId}/preview.mobile.glb`;
}

// Батч-проверка наличия миниатюры для листинга галереи — без похода в S3, только
// model_files. role='thumbnail' появится в схеме после MF-469 (пока просто пустой Set).
export async function modelIdsWithThumbnails(modelIds: string[]): Promise<Set<string>> {
  if (modelIds.length === 0) return new Set();
  const result = await pool.query<{ model_id: string }>(`select model_id from model_files where role = 'thumbnail' and model_id = any($1::uuid[])`, [modelIds]);
  return new Set(result.rows.map((row) => row.model_id));
}

// project_summary.file_count каталога (MF-1961, models/list.ts) — батч по PROJECT_FILE_ROLES
// (formats.ts), один запрос на всю страницу листинга, тот же приём, что modelIdsWithThumbnails
// выше (не N+1 по моделям).
export async function projectFileCountsForModels(modelIds: string[]): Promise<Map<string, number>> {
  if (modelIds.length === 0) return new Map();
  const result = await pool.query<{ model_id: string; count: string }>(
    `select model_id, count(*)::int as count
     from model_files
     where role = any($1::text[]) and model_id = any($2::uuid[])
     group by model_id`,
    [PROJECT_FILE_ROLES, modelIds],
  );
  return new Map(result.rows.map((row) => [row.model_id, Number(row.count)]));
}
