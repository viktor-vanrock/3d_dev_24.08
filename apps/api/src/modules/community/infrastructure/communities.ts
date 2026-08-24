import { pool } from "../../../db/client.ts";
import { slugify } from "../public/legacy-contract.ts";

// Сообщества/клубы (MF-35 Фаза 2, docs/epics/community.foundation.md). Роуты создания/ленты/деталей
// мигрированы в Nest (modules/community + nest/integration); здесь остаётся только разделяемый
// генератор уникального slug — его переиспользует ленивое заведение каталожных сабов
// (catalogCommunity.ts) при первой подписке.

export async function generateUniqueSlug(name: string): Promise<string> {
  const base = slugify(name) || "club";
  let candidate = base;
  let suffix = 1;
  while (true) {
    const existing = await pool.query(`select 1 from communities where slug = $1`, [candidate]);
    if (existing.rowCount === 0) return candidate;
    suffix += 1;
    candidate = `${base}-${suffix}`;
  }
}
