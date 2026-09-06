// Минимально жизнеспособный фильтр промптов (MF-353 п.2, MF-657) — не ML-модерация, а плоский
// список стемов/фраз для явно недопустимых категорий (оружие/взрывчатка, наркотики, CSAM/порно).
// Substring-матч по нижнему регистру намеренно грубый: ложные срабатывания (например «гранат»
// как фрукт) — приемлемая цена MVP, не переизобретаем классификатор здесь. Список расширяется
// без деплоя через GENERATION_BLOCKED_WORDS (comma-list, SECURITY.md § «Секреты» — не секрет,
// но использует отдельный env-паттерн для модерации промптов).
const BASE_BLOCKED_TERMS = [
  "оружи",
  "взрывчат",
  "бомба",
  "бомбу",
  "бомбы",
  "гранат",
  "глушитель для оружия",
  "наркотик",
  "героин",
  "кокаин",
  "метамфетамин",
  "детская порнограф",
  "порнограф",
  "child porn",
  "csam",
  "explosive",
  "firearm",
  "gunpowder",
  "grenade",
  "methamphetamine",
  "heroin",
  "cocaine",
  "porn",
];

function extraBlockedTerms(): string[] {
  return (process.env.GENERATION_BLOCKED_WORDS ?? "")
    .split(",")
    .map((term) => term.trim().toLowerCase())
    .filter(Boolean);
}

export function isPromptBlocked(prompt: string): boolean {
  const normalized = prompt.toLowerCase();
  return [...BASE_BLOCKED_TERMS, ...extraBlockedTerms()].some((term) => normalized.includes(term));
}
