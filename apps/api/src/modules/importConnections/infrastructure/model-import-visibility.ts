// Публичная видимость модели НЕ-владельцу (MF-340/MF-741): помимо конвейерного
// `status='ready'`, для импортированных черновиков (MF-37/MF-417 §6) требуется ещё и
// подтверждённое владение источником — `import_bindings.ownership_status='verified'`, а с
// MF-340 ещё и авторская публикация — `models.publish_status='published'` (отдельно от
// конвейерного `status`, см. mutate.ts). До этой карточки гейт проверялся только на явной
// попытке публикации (`PATCH /models/:id`, mutate.ts) — сам факт успешной mesh-конвертации
// (`status='ready'`) уже делал непроверенный импорт публично видимым в каталоге/на прямой
// ссылке, обходя анти-абьюз гейт MF-741. Один SQL-фрагмент переиспользуется во всех точках
// чтения (list/detail/asset/download/repository), чтобы условие не разъехалось по местам
// поодиночке.
export const UNVERIFIED_IMPORT_EXISTS_SQL = "exists (select 1 from import_bindings ib where ib.model_id = m.id and ib.ownership_status <> 'verified')";

// Project/Model split variant (task 6.5): `import_bindings` was re-pointed to the child Model id, so
// over the `models_compat_v1` aggregate (where `m.id` is the Project id) the binding is matched on the
// child id column `m.model_id`. Semantically identical predicate, correct key after the split.
export const UNVERIFIED_IMPORT_EXISTS_SQL_COMPAT = "exists (select 1 from import_bindings ib where ib.model_id = m.model_id and ib.ownership_status <> 'verified')";

export function isVisibleToNonOwner(row: { status: string; publish_status: string; has_unverified_import: boolean }): boolean {
  return row.status === "ready" && row.publish_status === "published" && !row.has_unverified_import;
}
