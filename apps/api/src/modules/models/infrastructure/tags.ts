import { pool } from "../../../db/client.ts";
import { ensureOwnedTags, findOwnedTagNames } from "../../community/public/index.ts";

// Общие хелперы для тегов моделей (MF-463, docs/design/marketplace.v2.md §3/§9): свободные теги
// без модерации, имя приводится к нижнему регистру на стороне БД (check-constraint в schema.ts).

const MAX_TAGS_PER_MODEL = 8;

function normalizeTagNames(raw: string[]): string[] {
  const seen = new Set<string>();
  for (const name of raw) {
    const cleaned = name.trim().toLowerCase().slice(0, 40);
    if (cleaned) seen.add(cleaned);
    if (seen.size >= MAX_TAGS_PER_MODEL) break;
  }
  return [...seen];
}

// Полностью заменяет набор тегов модели на переданный список имён (create/edit).
export async function syncModelTags(modelId: string, rawNames: string[]): Promise<void> {
  const names = normalizeTagNames(rawNames);

  await pool.query(`delete from model_tags where model_id = $1`, [modelId]);
  if (names.length === 0) return;

  const tagIds = await ensureOwnedTags(names);

  await pool.query(
    `insert into model_tags (model_id, tag_id)
     select $1, unnest($2::uuid[])
     on conflict do nothing`,
    [modelId, tagIds],
  );
}

// Батч-выборка тегов для набора моделей (используется списком и детальной ручкой).
export async function tagsForModels(modelIds: string[]): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  if (modelIds.length === 0) return map;

  const result = await pool.query<{ model_id: string; tag_id: string }>(`select model_id, tag_id from model_tags where model_id = any($1::uuid[])`, [modelIds]);
  const names = await findOwnedTagNames([...new Set(result.rows.map((row) => row.tag_id))]);

  for (const row of result.rows) {
    const name = names.get(row.tag_id);
    if (name === undefined) continue;
    const list = map.get(row.model_id) ?? [];
    list.push(name);
    list.sort();
    map.set(row.model_id, list);
  }
  return map;
}
