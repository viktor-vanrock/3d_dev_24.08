import { pool } from "../../../db/client.ts";
import { generateUniqueSlug } from "./communities.ts";

// Каталожные сабы (kind=machine|vendor) заявлены как "лениво создаются системой" ещё в комментарии
// community_foundation-миграции (MF-35 Ф2) — но эта ленивость нигде не была реализована: до
// MF-2039 три саба (Creality/QIDI/Snapmaker) заведены разовым ручным SQL. Эта функция — реальная
// реализация инварианта "у каждого vendor/machine в каталоге есть саб": вызывается из ЛЮБОГО места,
// где создаётся строка `vendors`/`machines` (catalog/resolve/run.ts, catalog/machine-candidates.ts,
// scripts/seed-vendor-catalog.ts) — не только из сегодняшнего курируемого списка брендов.
//
// Идемпотентна: subject (kind, subject_id) — источник истины, не slug. Если саб уже существует —
// просто возвращает его id, ничего не трогает (имя каталожной сущности меняется редко, а даже если
// изменится — не повод молча переименовывать существующий саб с историей/участниками).
export async function ensureCatalogCommunity(kind: "vendor" | "machine", subjectId: string, name: string): Promise<string> {
  const existing = await pool.query<{ id: string }>(`select id from communities where kind = $1 and subject_type = $1 and subject_id = $2`, [kind, subjectId]);
  if (existing.rows[0]) return existing.rows[0].id;

  const slug = await generateUniqueSlug(name);
  const created = await pool.query<{ id: string }>(
    `insert into communities (slug, name, kind, subject_type, subject_id)
     values ($1, $2, $3, $3, $4)
     on conflict (kind, subject_type, subject_id) where subject_id is not null
     do update set name = communities.name
     returning id`,
    [slug, name, kind, subjectId],
  );
  return created.rows[0]!.id;
}
