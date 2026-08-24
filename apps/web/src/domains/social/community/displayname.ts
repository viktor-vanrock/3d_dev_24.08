// Тестовые сиды добавляли к читаемому имени unix-подобный числовой идентификатор или
// служебный токен `mf1434-<id>`. В интерфейсе оставляем устойчивую читаемую часть, а исходное
// имя сохраняется в данных и доступно как title у карточки — преобразование полностью обратимо.
const GENERATED_TRAILING_ID = /\s+(?:(?:mf\d+|[a-z][a-z0-9]*)-)?\d{9,}$/iu;

export function communityDisplayName(name: string): string {
  const readable = name.replace(GENERATED_TRAILING_ID, "").trim();
  return readable || name;
}
