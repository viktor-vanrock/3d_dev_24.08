// Репозиторий чтения гайда сборки (MF-366, Фаза 1 эпика MF-18) — только модель данных, без
// HTTP/авторизации (это API-эндпоинты, вне зоны Data, вторая половина фазы — MF-18/Back).
// Вычитывает build_guides→build_steps→build_step_photos одним structured-объектом по model_id.
import { pool } from "../../../db/client.ts";
import { isUuid } from "../../../db/uuid.ts";

export interface BuildStepPhoto {
  id: string;
  s3Key: string;
  position: number;
  sizeBytes: number | null;
  mimeType: string | null;
}

export interface BuildStep {
  id: string;
  position: number;
  title: string;
  body: string | null;
  meshId: string | null;
  meshObjectRef: { readonly path: string } | null;
  parts: readonly { readonly name: string; readonly quantity?: string; readonly kind?: string }[];
  tools: readonly { readonly name: string; readonly quantity?: string; readonly kind?: string }[];
  photos: BuildStepPhoto[];
}

export interface BuildGuide {
  id: string;
  modelId: string;
  version: number;
  steps: BuildStep[];
}

interface StepRow {
  step_id: string;
  guide_id: string;
  guide_version: number;
  position: number;
  title: string;
  body: string | null;
  mesh_id: string | null;
  mesh_object_ref: { readonly path: string } | null;
  parts: readonly { readonly name: string; readonly quantity?: string; readonly kind?: string }[];
  tools: readonly { readonly name: string; readonly quantity?: string; readonly kind?: string }[];
  photo_id: string | null;
  photo_s3_key: string | null;
  photo_position: number | null;
  photo_size_bytes: string | null;
  photo_mime_type: string | null;
}

// Один гайд на models-строку (build_guides.model_id unique) — вычитывается целиком одним
// join'ом, шаги упорядочены position, фото шага — position внутри шага.
export async function getBuildGuideByModelId(modelId: string): Promise<BuildGuide | null> {
  if (!isUuid(modelId)) return null;

  const result = await pool.query<StepRow>(
    `select
       bs.id as step_id,
       bg.id as guide_id,
       bg.version as guide_version,
       bs.position,
       bs.title,
       bs.body,
       bs.mesh_id,
       bs.mesh_object_ref,
       bs.parts,
       bs.tools,
       bsp.id as photo_id,
       bsp.s3_key as photo_s3_key,
       bsp.position as photo_position,
       bsp.size_bytes as photo_size_bytes,
       bsp.mime_type as photo_mime_type
     from build_guides bg
     join build_steps bs on bs.guide_id = bg.id
     left join build_step_photos bsp on bsp.step_id = bs.id
     where bg.model_id = $1
     order by bs.position, bsp.position`,
    [modelId],
  );

  if (result.rows.length === 0) {
    const guide = await pool.query<{ id: string; version: number }>(`select id, version from build_guides where model_id = $1`, [modelId]);
    const row = guide.rows[0];
    if (!row) return null;
    return { id: row.id, modelId, version: row.version, steps: [] };
  }

  const steps = new Map<string, BuildStep>();
  for (const row of result.rows) {
    let step = steps.get(row.step_id);
    if (!step) {
      step = {
        id: row.step_id,
        position: row.position,
        title: row.title,
        body: row.body,
        meshId: row.mesh_id,
        meshObjectRef: row.mesh_object_ref,
        parts: row.parts,
        tools: row.tools,
        photos: [],
      };
      steps.set(row.step_id, step);
    }
    if (row.photo_id !== null && row.photo_s3_key !== null && row.photo_position !== null) {
      step.photos.push({
        id: row.photo_id,
        s3Key: row.photo_s3_key,
        position: row.photo_position,
        sizeBytes: row.photo_size_bytes === null ? null : Number(row.photo_size_bytes),
        mimeType: row.photo_mime_type,
      });
    }
  }

  const first = result.rows[0]!;
  return {
    id: first.guide_id,
    modelId,
    version: first.guide_version,
    steps: [...steps.values()],
  };
}

// project_summary.build_steps_count каталога (MF-1961, apps/api/src/models/list.ts) — батч на
// всю страницу листинга одним group by, тот же приём, что assets.ts::modelIdsWithThumbnails
// (не N+1 по моделям). Модели без гайда просто отсутствуют в Map — читающая сторона трактует
// как 0, гайд с пустыми шагами (см. фолбэк выше в getBuildGuideByModelId) даёт тот же 0 здесь.
export async function buildStepCountsForModels(modelIds: string[]): Promise<Map<string, number>> {
  if (modelIds.length === 0) return new Map();
  const result = await pool.query<{ model_id: string; count: string }>(
    `select bg.model_id, count(bs.id)::int as count
     from build_guides bg
     join build_steps bs on bs.guide_id = bg.id
     where bg.model_id = any($1::uuid[])
     group by bg.model_id`,
    [modelIds],
  );
  return new Map(result.rows.map((row) => [row.model_id, Number(row.count)]));
}
