// Нормализация имени модели для blocking/matching (MF-406, декомпозиция MF-648, entity
// resolution). Схлопывает регистр/пунктуацию/пробелы ("SV06 Plus" / "sv-06 plus" / "SV06Plus")
// в сравнимую форму. НЕ делает RU↔EN транслитерацию — кандидат под другим языком находит свою
// каноническую запись через machines.aliases (кто-то уже завёл алиас), не через угадывание
// созвучия; alias-точка входа — matcher (./match.ts), не этот модуль.
export function normalizeModelName(raw: string): string {
  return raw
    .normalize("NFKC")
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

// Без пробелов вовсе — под сравнение близости (./similarity.ts), не под чтение человеком.
// Убирает разночтения дефис/пробел/слитно ("SV-06 Plus" / "SV06 Plus" / "SV06Plus" → одна
// строка), которые normalizeModelName оставляет как разные токены и которые иначе сбивают
// триграммный скор ниже HIGH_MATCH_THRESHOLD у форм одной и той же модели.
export function compactModelName(raw: string): string {
  return normalizeModelName(raw).replace(/ /g, "");
}
