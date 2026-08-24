// Path/body params под `::uuid`-каст в Postgres — не то же самое, что "валидная строка": каст
// на не-UUID падает необработанной ошибкой (500), а не даёт спокойный 404/400 (MF-712/MF-713,
// воспроизведено в проде на GET /models/:id с ботовым/сканерным непарсящимся id). detail.ts уже
// закрыт своей версией этой проверки (MF-712) — здесь тот же паттерн для остальных ручек
// models/*, принимающих :id (asset/mutate/vote/download/description-images).
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}
