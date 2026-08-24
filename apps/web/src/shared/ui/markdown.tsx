import DOMPurify, { type Config as DOMPurifyConfig } from "dompurify";
import { marked } from "marked";
import "./markdown.css";

// Рендер Markdown описания (docs/design/projects.multiformat.md §3): безопасное GFM-подмножество,
// один рендерер для вкладки «Предпросмотр» и публичной страницы (§3.3). raw HTML вырезается ВСЕГДА
// (§3.4/§5 п.6, XSS-непробиваемость), внешние хотлинки картинок не рендерятся как картинки (§3.2).
// Вынесено в shared/ui (микроэтап 7.6): рендер-only, без доменных зависимостей — им пользуются
// commerce и social. Редактор (MarkdownEditor, нужен upload-API) остаётся в commerce.

marked.setOptions({ gfm: true, breaks: false });

// Allowlist элементов §3.4 — то, что сверх него, DOMPurify вырезает вместе с raw HTML/атрибутами-
// обработчиками/`javascript:`-URL. URI-схема — дефолтный DOMPurify ALLOWED_URI_REGEXP (не
// переопределяем): он уже блокирует javascript:/data:/vbscript: и при этом пропускает
// относительные пути (свои же /assets/... ссылки на description_image, §3.2) — самодельный
// regex с требованием обязательной схемы однажды случайно резал ровно такие ссылки.
const SANITIZE_CONFIG: DOMPurifyConfig = {
  ALLOWED_TAGS: [
    "p", "br", "hr",
    "h1", "h2", "h3", "h4", "h5", "h6",
    "ul", "ol", "li",
    "table", "thead", "tbody", "tr", "th", "td",
    "code", "pre",
    "a", "img",
    "blockquote",
    "strong", "em", "del",
  ],
  ALLOWED_ATTR: ["href", "src", "alt", "title", "target", "rel"],
};

// Внешние хотлинки картинок не рендерятся как картинки (§3.2, §3.4 таблица «Картинки») —
// только свои, загруженные через роль description_image (тот же домен API-ассетов). Хотлинк
// вырезается совсем (не деградирует в ссылку — иначе разметка «плывёт» пустым alt-текстом).
function stripForeignImages(html: string, ownAssetOrigin: string | null): string {
  const container = document.createElement("div");
  container.innerHTML = html;
  container.querySelectorAll("img").forEach((img) => {
    const src = img.getAttribute("src") ?? "";
    const isOwn = src.startsWith("/") || (ownAssetOrigin !== null && src.startsWith(ownAssetOrigin));
    if (!isOwn) img.remove();
  });
  return container.innerHTML;
}

export function renderMarkdown(source: string, ownAssetOrigin: string | null = null): string {
  const rawHtml = marked.parse(source, { async: false }) as string;
  const sanitized = DOMPurify.sanitize(rawHtml, SANITIZE_CONFIG);
  return stripForeignImages(sanitized, ownAssetOrigin);
}

// §3.4/§3.3: один и тот же рендер для предпросмотра редактора и публичной страницы —
// typography-класс общий (markdownBody), содержимое каждый раз пересобирается санитайзером.
export function MarkdownBody({ source }: { source: string }) {
  if (!source.trim()) return null;
  // html уже прогнан через DOMPurify выше (allowlist §3.4) — raw HTML/атрибуты-обработчики
  // вырезаны, dangerouslySetInnerHTML здесь безопасен.
  const html = renderMarkdown(source);
  return <div className="markdownBody" dangerouslySetInnerHTML={{ __html: html }} />;
}
