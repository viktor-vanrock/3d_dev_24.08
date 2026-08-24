export type SeoRoute =
  | { readonly kind: "home" }
  | { readonly kind: "catalog"; readonly tag?: string }
  | { readonly kind: "model"; readonly id: string }
  | { readonly kind: "profile"; readonly username: string }
  | { readonly kind: "unknown" };

export interface MetaTags {
  readonly title: string;
  readonly description: string;
  readonly canonical: string;
  readonly index: boolean;
  readonly ogType: "website" | "profile";
  readonly ogImage?: string | null;
  readonly ogImageAlt?: string;
}

export interface SitemapEntry {
  readonly loc: string;
  readonly lastmod?: string;
}

export interface SeoMetaResponse {
  readonly status: 200 | 404;
  readonly meta: MetaTags;
  readonly html: string;
}

export function parseSeoPath(rawPath: string): SeoRoute {
  const [pathPart, query] = rawPath.split("?");
  const parts = (pathPart ?? "").replace(/^\/+/, "").split("/").filter(Boolean);
  if (parts[0] === "project" && parts[1]) return { kind: "model", id: safeDecode(parts[1]) };
  if (parts[0] === "project") {
    const tag = new URLSearchParams(query ?? "").get("tag");
    return tag === null ? { kind: "catalog" } : { kind: "catalog", tag };
  }
  if (parts[0] === "u" && parts[1]) return { kind: "profile", username: safeDecode(parts[1]) };
  if (parts.length === 0) return { kind: "home" };
  return { kind: "unknown" };
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function normalizeDescription(raw: string | null | undefined, fallback: string, max = 200): string {
  const text = (raw ?? "").replace(/\s+/g, " ").trim();
  if (!text) return fallback;
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1).trimEnd()}…`;
}

export function markdownToPlain(raw: string): string {
  return raw
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/[*_`~]/g, "");
}

export function renderMetaHtml(meta: MetaTags): string {
  const lines = [
    `<title>${escapeHtml(meta.title)}</title>`,
    `<meta name="description" content="${escapeHtml(meta.description)}" />`,
    `<link rel="canonical" href="${escapeHtml(meta.canonical)}" />`,
    meta.index ? '<meta name="robots" content="index, follow" />' : '<meta name="robots" content="noindex, nofollow" />',
    '<meta property="og:site_name" content="3mf.tech" />',
    `<meta property="og:type" content="${meta.ogType}" />`,
    `<meta property="og:title" content="${escapeHtml(meta.title)}" />`,
    `<meta property="og:description" content="${escapeHtml(meta.description)}" />`,
    `<meta property="og:url" content="${escapeHtml(meta.canonical)}" />`,
  ];
  if (meta.ogImage) {
    lines.push(`<meta property="og:image" content="${escapeHtml(meta.ogImage)}" />`);
    lines.push('<meta name="twitter:card" content="summary_large_image" />');
    lines.push(`<meta name="twitter:image" content="${escapeHtml(meta.ogImage)}" />`);
    if (meta.ogImageAlt) lines.push(`<meta property="og:image:alt" content="${escapeHtml(meta.ogImageAlt)}" />`);
  } else {
    lines.push('<meta name="twitter:card" content="summary" />');
  }
  lines.push(`<meta name="twitter:title" content="${escapeHtml(meta.title)}" />`);
  lines.push(`<meta name="twitter:description" content="${escapeHtml(meta.description)}" />`);
  return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8" />
${lines.join("\n")}
</head>
<body></body>
</html>
`;
}

function escapeXml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

export function buildSitemapXml(entries: readonly SitemapEntry[]): string {
  const urls = entries
    .map((entry) => {
      const lastmod = entry.lastmod === undefined ? "" : `\n    <lastmod>${escapeXml(entry.lastmod)}</lastmod>`;
      return `  <url>\n    <loc>${escapeXml(entry.loc)}</loc>${lastmod}\n  </url>`;
    })
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}

export function sitemapDate(value: Date): string {
  const day = value.getUTCDay();
  const diffToMonday = day === 0 ? 6 : day - 1;
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate() - diffToMonday)).toISOString().slice(0, 10);
}

export function pluralProjects(value: number): string {
  const mod10 = value % 10;
  const mod100 = value % 100;
  if (mod10 === 1 && mod100 !== 11) return "проект";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return "проекта";
  return "проектов";
}
