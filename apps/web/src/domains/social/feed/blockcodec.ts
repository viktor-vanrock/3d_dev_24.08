export type FeedBlockType =
  | "text"
  | "heading-2"
  | "heading-3"
  | "bullet-list"
  | "number-list"
  | "quote"
  | "code"
  | "diagram"
  | "image"
  | "model"
  | "project"
  | "gitverse"
  | "sources";

export interface FeedBlock {
  type: FeedBlockType;
  content: string;
}

// Scout keeps claim anchors in the stored Markdown so the review pipeline can trace assertions
// back to its evidence. They are machine metadata, not article copy: remove them only at the
// presentation boundary while leaving the persisted body and provenance untouched.
export function stripEditorialClaimMarkers(source: string): string {
  return source.replace(/\s*\[claim:[a-zA-Z0-9._-]+\]/g, "");
}

export interface FeedSourceItem {
  url: string;
  title?: string;
}

export interface FeedEmbedData {
  kind: "image" | "model" | "project" | "gitverse" | "sources";
  url?: string;
  id?: string;
  title?: string;
  thumbUrl?: string | null;
  description?: string | null;
  // kind="sources" — единственный embed-вид со списком, а не одиночным вложением (запрос
  // оператора 2026-07-21: "источников может быть много", один embed-блок = один флекс-ряд
  // карточек, а не N отдельных блоков подряд).
  items?: FeedSourceItem[];
}

const EMBED_START = "<!-- portal:embed ";
const EMBED_END = "<!-- /portal:embed -->";

export function parseFeedEmbed(content: string): FeedEmbedData | null {
  if (!content.trim()) return null;
  try {
    const parsed = JSON.parse(content) as FeedEmbedData;
    if (!parsed || !["image", "model", "project", "gitverse", "sources"].includes(parsed.kind)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function isFeedEmbedComplete(data: FeedEmbedData): boolean {
  if (data.kind === "image") return Boolean(data.url?.trim());
  if (data.kind === "model" || data.kind === "project") return Boolean(data.id?.trim());
  if (data.kind === "sources") return Boolean(data.items && data.items.length > 0);
  return Boolean(data.url?.trim());
}

function escapeMarkdownLabel(value: string): string {
  return value.replace(/[[\]]/g, "");
}

function embedFallback(data: FeedEmbedData): string {
  const title = escapeMarkdownLabel(data.title?.trim() || "Вложение");
  if (data.kind === "image" && data.url) return `![${title}](${data.url})`;
  if ((data.kind === "model" || data.kind === "project") && data.id) {
    const label = data.kind === "model" ? "3D-модель" : "Проект";
    return `[${label} «${title}»](/project/${encodeURIComponent(data.id)})`;
  }
  if (data.kind === "gitverse" && data.url) return `[GitVerse · ${title}](${data.url})`;
  if (data.kind === "sources" && data.items?.length) {
    return `Источники: ${data.items.map((item) => `[${item.title || item.url}](${item.url})`).join(", ")}`;
  }
  return title;
}

function parseEmbedPart(part: string): FeedBlock | null {
  if (!part.startsWith(EMBED_START) || !part.endsWith(EMBED_END)) return null;
  const firstLineEnd = part.indexOf("-->");
  if (firstLineEnd < 0) return null;
  const raw = part.slice(EMBED_START.length, firstLineEnd).trim();
  const data = parseFeedEmbed(raw);
  if (!data) return null;
  return { type: data.kind, content: JSON.stringify(data) };
}

function parseMarkdownImage(part: string): FeedBlock | null {
  // Scout writes portable Markdown first, while the browser editor writes typed portal embeds.
  // Treat a standalone Markdown image as the same typed block so both authoring paths get the
  // richer renderer (host validation, caption and responsive layout) instead of silently losing it.
  const match = part.trim().match(/^!\[([^\]]*)\]\((https:\/\/[^\s)]+)(?:\s+["'][^"']*["'])?\)$/);
  if (!match) return null;
  return {
    type: "image",
    content: JSON.stringify({
      kind: "image",
      url: match[2],
      title: match[1]?.trim() || undefined,
    } satisfies FeedEmbedData),
  };
}

export function parseFeedBlocks(markdown: string): FeedBlock[] {
  if (!markdown) return [{ type: "text", content: "" }];

  return markdown.split(/\n{2,}/).map((part): FeedBlock => {
    const embed = parseEmbedPart(part);
    if (embed) return embed;
    const markdownImage = parseMarkdownImage(part);
    if (markdownImage) return markdownImage;
    if (/^## (?!#)/.test(part)) return { type: "heading-2", content: part.slice(3) };
    if (/^### /.test(part)) return { type: "heading-3", content: part.slice(4) };
    if (part.split("\n").every((line) => line.startsWith("- "))) {
      return { type: "bullet-list", content: part.split("\n").map((line) => line.slice(2)).join("\n") };
    }
    if (part.split("\n").every((line) => /^\d+\. /.test(line))) {
      return { type: "number-list", content: part.split("\n").map((line) => line.replace(/^\d+\. /, "")).join("\n") };
    }
    if (part.split("\n").every((line) => line.startsWith("> "))) {
      return { type: "quote", content: part.split("\n").map((line) => line.slice(2)).join("\n") };
    }
    // Диаграммы (2026-07-21): ```mermaid-фенс — тот же нативный markdown-синтаксис, что любая
    // LLM (включая эту) уже умеет писать без специального обучения, распознаём его тем же
    // способом, что и обычный ```-код-блок ниже, просто с языковым тегом.
    if (part.startsWith("```mermaid\n") && part.endsWith("\n```")) {
      return { type: "diagram", content: part.slice("```mermaid\n".length, -4) };
    }
    if (part.startsWith("```\n") && part.endsWith("\n```")) {
      return { type: "code", content: part.slice(4, -4) };
    }
    return { type: "text", content: part };
  });
}

export function serializeFeedBlocks(blocks: FeedBlock[]): string {
  return blocks
    .map((block) => {
      if (["image", "model", "project", "gitverse", "sources"].includes(block.type)) {
        const data = parseFeedEmbed(block.content);
        if (!data || !isFeedEmbedComplete(data)) return "";
        return `${EMBED_START}${JSON.stringify(data)} -->\n${embedFallback(data)}\n${EMBED_END}`;
      }
      if (block.type === "heading-2") return `## ${block.content}`;
      if (block.type === "heading-3") return `### ${block.content}`;
      if (block.type === "bullet-list") return block.content.split("\n").map((line) => `- ${line}`).join("\n");
      if (block.type === "number-list") return block.content.split("\n").map((line, index) => `${index + 1}. ${line}`).join("\n");
      if (block.type === "quote") return block.content.split("\n").map((line) => `> ${line}`).join("\n");
      if (block.type === "code") return `\`\`\`\n${block.content}\n\`\`\``;
      if (block.type === "diagram") return `\`\`\`mermaid\n${block.content}\n\`\`\``;
      return block.content;
    })
    .join("\n\n");
}

export function hasFeedBlockContent(markdown: string): boolean {
  return parseFeedBlocks(markdown).some((block) => {
    if (["image", "model", "project", "gitverse", "sources"].includes(block.type)) {
      const data = parseFeedEmbed(block.content);
      return data ? isFeedEmbedComplete(data) : false;
    }
    return block.content.trim().length > 0;
  });
}
