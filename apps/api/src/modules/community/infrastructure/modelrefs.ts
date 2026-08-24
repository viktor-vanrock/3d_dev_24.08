import { pool } from "../../../db/client.ts";

// Inline-превью модели в посте (MF-744, часть MF-35 Ф2/MF-415 п.2): если content поста
// ссылается на карточку модели (canonical path seo/urls.ts::modelCanonicalPath, "/project/:id"),
// GET /threads/:id резолвит ссылку в мини-карточку — сам рендер карточки на фронте (отдельная
// UI-задача), здесь только API-обогащение. Видимость — та же публичная проверка, что list.ts/
// asset.ts (models/visibility.ts): чужая непубличная модель ссылкой не резолвится, остаётся
// голым текстом, что и есть корректное поведение (не палим существование чужого черновика).

const MODEL_LINK_RE = /\/project\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/gi;

export function extractModelIds(content: string): string[] {
  const ids = new Set<string>();
  for (const match of content.matchAll(MODEL_LINK_RE)) {
    ids.add(match[1]!.toLowerCase());
  }
  return [...ids];
}

export interface ResolvedModel {
  id: string;
  title: string;
  thumbnail_url: string | null;
}

interface ModelRow {
  id: string;
  model_id: string;
  revision_id: string;
  title: string;
  has_thumbnail: boolean;
}

// Батч для GET /threads/:id — один запрос на все посты треда (тот же приём, что
// attachmentsForPosts/tagsForThreads), не поход в БД на пост.
export async function resolvedModelsForPosts(posts: Array<{ id: string; content: string }>): Promise<Map<string, ResolvedModel[]>> {
  const idsByPost = new Map<string, string[]>();
  const allIds = new Set<string>();
  for (const post of posts) {
    const ids = extractModelIds(post.content);
    if (ids.length === 0) continue;
    idsByPost.set(post.id, ids);
    for (const id of ids) allIds.add(id);
  }
  if (allIds.size === 0) return new Map();

  const result = await pool.query<ModelRow>(
    `select p.id, prm.model_id, prm.model_revision_id as revision_id,
            pr.metadata_snapshot ->> 'title' as title,
            exists(
              select 1 from model_revision_files f
               where f.model_revision_id = prm.model_revision_id and f.role = 'preview'
            ) as has_thumbnail
       from projects p
       join project_revisions pr on pr.id = p.published_revision_id and pr.project_id = p.id
       join project_revision_models prm on prm.project_revision_id = pr.id and prm.model_id = pr.primary_model_id
      where p.id = any($1::uuid[]) and p.deleted_at is null
        and not exists (
          select 1 from import_bindings ib
           where ib.model_id = prm.model_id and ib.ownership_status <> 'verified'
        )`,
    [[...allIds]],
  );
  const visibleById = new Map(result.rows.map((row) => [row.id, row]));

  const out = new Map<string, ResolvedModel[]>();
  for (const [postId, ids] of idsByPost) {
    const resolved: ResolvedModel[] = [];
    for (const id of ids) {
      const model = visibleById.get(id);
      if (!model) continue;
      resolved.push({
        id: model.id,
        title: model.title,
        thumbnail_url: model.has_thumbnail ? `/projects/${model.id}/models/${model.model_id}/revisions/${model.revision_id}/preview.glb` : null,
      });
    }
    if (resolved.length > 0) out.set(postId, resolved);
  }
  return out;
}
