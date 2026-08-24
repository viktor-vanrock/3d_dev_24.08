// Сборка индексируемого текста модели под эмбеддинги (MF-1016, Фаза 1 эпика нейропоиска,
// docs/epics/neural.search.md § «Что именно эмбеддим»): title + description + tags — один
// текст на документ, отдельных векторов на поле не заводим (эпик явно против без доказанной
// необходимости).

// GigaEmbeddings/Qwen3-Embedding токенайзеры недоступны на стороне apps/api (эмбеддинг считает
// apps/giga, MF-1015) — здесь только грубая, но детерминированная оценка длины. ~2.5 символа на
// токен — консервативная оценка для кириллицы (реальные BPE-токенайзеры для RU обычно дают
// 2-3 символа/токен), так что усечение по этой оценке не даёт документу превысить реальный
// лимit модели при вызове /embed.
const CHARS_PER_TOKEN_ESTIMATE = 2.5;

export const DEFAULT_MAX_INDEX_TOKENS = 3000;

// Markdown-синтаксис картинки/ссылки — в индексируемом тексте это шум, не смысл (описание
// хранится как сырой markdown, models/description.ts).
const MARKDOWN_IMAGE_RE = /!\[([^\]]*)\]\([^)]*\)/g;
const MARKDOWN_LINK_RE = /\[([^\]]*)\]\([^)]*\)/g;
const MARKDOWN_HEADING_RE = /^#{1,6}\s+/gm;
const MARKDOWN_EMPHASIS_RE = /[*_`~]+/g;

function stripMarkdown(text: string): string {
  return text
    .replace(MARKDOWN_IMAGE_RE, "$1")
    .replace(MARKDOWN_LINK_RE, "$1")
    .replace(MARKDOWN_HEADING_RE, "")
    .replace(MARKDOWN_EMPHASIS_RE, "")
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function truncateToTokenLimit(text: string, maxTokens: number): string {
  const maxChars = Math.floor(maxTokens * CHARS_PER_TOKEN_ESTIMATE);
  if (text.length <= maxChars) return text;
  // Режем по границе слова, чтобы не отдавать в эмбеддинг обрубленный на середине токен.
  const cut = text.slice(0, maxChars);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > 0 ? cut.slice(0, lastSpace) : cut).trim();
}

export interface IndexableModel {
  title: string;
  description: string | null;
  tags: string[];
}

export interface BuildIndexTextOptions {
  // Лимит в токенах модели эмбеддингов (уточняется в MF-1015 — дефолт консервативен и покрывает
  // и GigaEmbeddings (4096), и Qwen3-Embedding варианты).
  maxTokens?: number;
}

// Детерминированная сборка: для одного и того же входа всегда один и тот же документ (важно для
// идемпотентного переиндексирования — MF-348 "Готово когда").
export function buildModelIndexText(model: IndexableModel, options: BuildIndexTextOptions = {}): string {
  const maxTokens = options.maxTokens ?? DEFAULT_MAX_INDEX_TOKENS;

  const title = model.title.trim();
  const description = model.description ? stripMarkdown(model.description) : "";
  const tags = model.tags.map((tag) => tag.trim()).filter(Boolean);

  const parts = [title, description, tags.join(", ")].filter((part) => part.length > 0);
  const document = parts.join("\n\n");

  return truncateToTokenLimit(document, maxTokens);
}
