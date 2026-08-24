// Продюсер очереди model-index.v1 (packages/contracts/jobs/search.ts) — apps/api/src/models
// (Back) → apps/search (AI, консюмер, MF-1998). Ставит/обновляет строку `search_index_jobs`
// под identity активного текстового профиля (`hyperpc/qwen3-vl-embedding-2b`, `v1`, dim=2048,
// apps/search/src/portal_search/profiles.py — тот же профиль, что реально claim'ит консюмер) по
// событию изменения индексируемого текста (title+description+tags, buildModelIndexText из
// ./indexText.ts) — вызывается из mutate.ts (PATCH /models/:id) и upload.ts (POST /models), те
// же точки, что уже пишут title/description/tags (neural.index.contract.md §2.1: "событие
// эмиттит апи-слой, не индексатор").
//
// MF-2022: раньше профиль был `gigachat/Embeddings`/dim=1024 (MF-2013) — активного консюмера под
// него не было (apps/search claim'ит только `hyperpc/%`), а GigaChat-креды на VDS пусты и в
// прод, и на dev, так что тот путь был мёртв вдвойне. Переключение на `hyperpc/%` — простая
// замена identity, не параллельный rollout (схема Data, MF-2003, допускает оба профиля
// одновременно как разные строки — см. packages/contracts/jobs/search.ts, но заводить второй
// живой профиль под несуществующие креды смысла нет). Если GigaChat-креды когда-нибудь появятся
// и понадобится текстовый профиль параллельно — это отдельная карта, схема уже готова.
//
// Дебаунс и hash-гейт (neural.index.contract.md §2.2/§2.3) — одним атомарным UPSERT, без
// отдельного планировщика: `ON CONFLICT ... DO UPDATE ... WHERE` бьёт мимо (0 строк, no-op),
// если сохранённый `text_sha256` уже совпадает и строка не `failed` — done/queued/running с тем
// же текстом не тратят вызов `/embed` повторно и не двигают `generation`. Любое реальное
// изменение текста (включая повтор поверх ещё не забранной `queued`-строки — natural debounce)
// или ретрай `failed` — инкрементирует `generation`, фенсинг-токен воркера
// (apps/search/src/portal_search/index_lease.py), сбрасывает `status` в `queued`.

import { createHash } from "node:crypto";
import { pool } from "../../../db/client.ts";
import { buildModelIndexText, type IndexableModel } from "./indexText.ts";

export const SEARCH_TEXT_EMBEDDING_MODEL = "hyperpc/qwen3-vl-embedding-2b" as const;
export const SEARCH_TEXT_EMBEDDING_VERSION = "v1" as const;
export const SEARCH_TEXT_EMBEDDING_DIM = 2048 as const;

export function computeModelIndexTextSha256(model: IndexableModel): Buffer {
  return createHash("sha256").update(buildModelIndexText(model), "utf8").digest();
}

/** true — строка `search_index_jobs` была реально поставлена/обновлена (не отфильтрована hash-гейтом). */
export async function enqueueModelIndexJob(modelId: string, model: IndexableModel): Promise<boolean> {
  const textSha256 = computeModelIndexTextSha256(model);

  const result = await pool.query(
    `insert into search_index_jobs (model_id, embedding_model, embedding_version, dim, text_sha256, status, generation)
     values ($1, $2, $3, $4, $5, 'queued', 1)
     on conflict (model_id, embedding_model, embedding_version) do update
       set text_sha256 = excluded.text_sha256,
           status = 'queued',
           generation = search_index_jobs.generation + 1,
           updated_at = now()
       where search_index_jobs.text_sha256 is distinct from excluded.text_sha256
          or search_index_jobs.status = 'failed'`,
    [modelId, SEARCH_TEXT_EMBEDDING_MODEL, SEARCH_TEXT_EMBEDDING_VERSION, SEARCH_TEXT_EMBEDDING_DIM, textSha256],
  );

  return (result.rowCount ?? 0) > 0;
}
