// Строковая близость нормализованных имён (MF-406, декомпозиция MF-648, matching-шаг entity
// resolution). Триграммный коэффициент Дайса — тот же принцип, что pg_trgm (уже используется в
// схеме на models.title/description, docs/db/schema.ts), без похода в LLM/семантическое
// сравнение: "точное/близкое совпадение" из задачи покрывается этим, спорные пары остаются
// на крючке под будущий семантический матчер (см. TODO(AI) в ./match.ts).
function trigrams(value: string): Set<string> {
  const padded = `  ${value} `; // паддинг краёв — короткие строки тоже дают хотя бы одну грамму
  const grams = new Set<string>();
  for (let i = 0; i <= padded.length - 3; i += 1) {
    grams.add(padded.slice(i, i + 3));
  }
  return grams;
}

/** Коэффициент Дайса по триграммам, [0, 1]. Пустые строки считаются похожими, только если обе пусты. */
export function trigramSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length === 0 || b.length === 0) return 0;

  const ga = trigrams(a);
  const gb = trigrams(b);
  let common = 0;
  for (const g of ga) {
    if (gb.has(g)) common += 1;
  }
  return (2 * common) / (ga.size + gb.size);
}
