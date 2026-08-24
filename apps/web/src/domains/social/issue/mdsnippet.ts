// Markdown → plain-text сниппет для карточки ленты (docs/design/ideas.md §2.1 «обрезка
// описания… срендеренные в plain-text: заголовки/списки схлопнуты в текст, ссылки → текст-
// подпись»). MF-497 (market/markdown.tsx renderMarkdown) даёт html-рендер для полного описания
// (issuestubs.tsx §3.2 будущей страницы идеи) — под 2-строчный сниппет ленты нужен именно plain-
// text, не html+line-clamp (line-clamp на html обрежет посреди тега); html→plain через DOM было
// бы точнее, но карточек в ленте много и это лишний парс на каждую — здесь достаточно лёгкой
// regex-зачистки самых частых конструкций GFM-подмножества MF-497 (заголовки/акценты/списки/
// ссылки/код/цитаты), не полноценного парсера.
export function markdownToSnippet(source: string): string {
  return source
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^\s*>\s?/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/^\s*\d+\.\s+/gm, "")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[*_~`]{1,3}/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
