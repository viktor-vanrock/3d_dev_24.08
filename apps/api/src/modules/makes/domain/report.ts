// Репорт-флоу Make (MF-780): порог длины причины жалобы. Сам route мигрирован в Nest
// (modules/makes + nest/integration); здесь остаётся только разделяемая константа.

// Экспортируется — models/report.ts (MF-1788) переиспользует ровно этот лимит для жалоб на
// модель, чтобы не заводить второй magic number под тот же смысл поля. Nest-адаптеры
// (nest/integration/models.adapters.ts) импортируют его как единый источник.
export const REASON_MAX_LENGTH = 500;
