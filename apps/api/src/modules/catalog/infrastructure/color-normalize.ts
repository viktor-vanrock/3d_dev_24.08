// RU→канонический (EN) цвет для свободного ввода (MF-1902). У бренд-бутстрапов (см.
// import-ru-vendors-bootstrap.ts) color_name уже английский канон ("Black"/"White"/"Natural"/
// "Unspecified"); «Предложить филамент» (MF-1793 п.6, parseUserSuggestionRaw в
// material-candidates.merge.ts) до этой карточки писал raw ввод как есть — русские записи
// («Черный») и английские («Black») сосуществовали в одной колонке, и точный ilike-фильтр
// /materials?color= совпадал только с языком конкретной записи. Словарь — осознанный дубликат
// COLOR_ALIASES у apps/web/src/materials/catalog.ts:32 (та сторона переводит популярные RU-цвета
// в EN перед отправкой запроса, эта — канонизирует то, что реально долетает и ложится в БД);
// contracts-пакет под кросс-side цвета не заведён, схлопывать через него — отдельная карточка.
// Меняя один список, синхронизируй оба ключами.
const COLOR_ALIASES: Record<string, string> = {
  чёрный: "Black",
  черный: "Black",
  белый: "White",
  красный: "Red",
  синий: "Blue",
  голубой: "Blue",
  зелёный: "Green",
  зеленый: "Green",
  жёлтый: "Yellow",
  желтый: "Yellow",
  серый: "Gray",
  серебристый: "Silver",
  natural: "Natural",
  unspecified: "Unspecified",
};

// Точное однословное совпадение переводим в канон; составные («Чёрный сатин») оставляем как
// есть — /materials?color= матчит их подстрочно (materials.ts), а угадывать композицию RU-цвет +
// отделка тут не задача этой карточки.
export function normalizeColorName(raw: string): string {
  const trimmed = raw.trim();
  const alias = COLOR_ALIASES[trimmed.toLocaleLowerCase("ru-RU")];
  return alias ?? trimmed;
}
