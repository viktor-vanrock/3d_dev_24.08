import { useRef, useState } from "react";
import { DescriptionImageError, type DescriptionImageErrorCode, uploadDescriptionImage } from "./models.ts";
import { apiAssetUrl } from "@shared/api";

// renderMarkdown + MarkdownBody (рендер-only, безопасное GFM-подмножество §3.4) вынесены в
// shared/ui (микроэтап 7.6) — ими пользуются commerce и social. Здесь остаётся MarkdownEditor,
// завязанный на upload-API описаний (uploadDescriptionImage) — доменная логика commerce.
// Реэкспорт renderMarkdown/MarkdownBody сохраняет существующие импорты внутри commerce.
import { MarkdownBody, renderMarkdown, Chip, Tooltip } from "@shared/ui";
export { renderMarkdown, MarkdownBody };

const MAX_DESCRIPTION_BYTES = 50 * 1024;

function byteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

export function formatKb(bytes: number): string {
  return `${Math.round(bytes / 1024)}`;
}

// Тулбар вставки markdown-разметки в textarea (§3.1) — обрамляет выделение / вставляет шаблон
// в позиции курсора, не превращает в rich-text.
function wrapSelection(
  textarea: HTMLTextAreaElement,
  before: string,
  after: string,
  placeholder: string,
): { value: string; selStart: number; selEnd: number } {
  const { selectionStart, selectionEnd, value } = textarea;
  const selected = value.slice(selectionStart, selectionEnd) || placeholder;
  const next = value.slice(0, selectionStart) + before + selected + after + value.slice(selectionEnd);
  return { value: next, selStart: selectionStart + before.length, selEnd: selectionStart + before.length + selected.length };
}

function insertAtLineStart(textarea: HTMLTextAreaElement, prefix: string): { value: string; selStart: number; selEnd: number } {
  const { selectionStart, value } = textarea;
  const lineStart = value.lastIndexOf("\n", selectionStart - 1) + 1;
  const next = value.slice(0, lineStart) + prefix + value.slice(lineStart);
  const pos = selectionStart + prefix.length;
  return { value: next, selStart: pos, selEnd: pos };
}

function insertAtCursor(textarea: HTMLTextAreaElement, text: string): { value: string; selStart: number; selEnd: number } {
  const { selectionStart, selectionEnd, value } = textarea;
  const next = value.slice(0, selectionStart) + text + value.slice(selectionEnd);
  const pos = selectionStart + text.length;
  return { value: next, selStart: pos, selEnd: pos };
}

const IMAGE_ACCEPT = "image/png,image/jpeg,image/gif,image/webp";

const IMAGE_ERROR_MESSAGES: Record<DescriptionImageErrorCode, string> = {
  DESCRIPTION_TOO_MANY_IMAGES: "Не больше 20 картинок в описании.",
  FILE_TOO_LARGE: "Картинка больше 10 МБ, уменьшите файл.",
  UNSUPPORTED_IMAGE_FORMAT: "Формат не поддерживается. Загрузите PNG, JPEG, GIF или WebP.",
  storage_not_configured: "Загрузка картинок сейчас недоступна.",
  unauthorized: "Сессия истекла — обновите страницу.",
  network: "Не удалось загрузить. Проверьте связь и попробуйте снова.",
  unknown: "Не удалось загрузить картинку.",
};

export interface MarkdownEditorProps {
  id: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  placeholder?: string;
  // Картинки описания (role description_image, §3.2) грузятся в уже существующую модель —
  // до её создания (первый шаг «Добавить проект») загружать некуда, кнопка «картинка» тогда
  // неактивна (см. modelId ? … в тулбаре ниже). Второй потребитель — пост ленты
  // (feed.post.editor.md §2.5): modelId играет роль id-цели загрузки вообще (не обязательно
  // модели), uploadImage меняет, куда именно летит файл — компонент сам не знает про «пост».
  modelId?: string;
  uploadImage?: (targetId: string, file: File) => Promise<{ url: string }>;
  fieldLabel?: string;
  imageDisabledHint?: string;
  showPreview?: boolean;
  showByteCounter?: boolean;
  helperText?: string;
}

// Редактор описания (§3.1): тулбар (опционален функционально, но собран) + вкладки
// Редактор/Предпросмотр (Chip-сегмент, как сортировка каталога) + textarea + счётчик КБ.
// Не WYSIWYG — тулбар вставляет markdown-синтаксис, не превращает в rich-text.
export function MarkdownEditor({
  id,
  value,
  onChange,
  disabled,
  placeholder,
  modelId,
  uploadImage = uploadDescriptionImage,
  fieldLabel = "Описание (необязательно)",
  imageDisabledHint = "Сначала сохраните проект — потом добавляйте картинки",
  showPreview = true,
  showByteCounter = showPreview,
  helperText,
}: MarkdownEditorProps) {
  const [tab, setTab] = useState<"edit" | "preview">("edit");
  const [imageUploading, setImageUploading] = useState(false);
  const [imageError, setImageError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const bytes = byteLength(value);
  const overLimit = bytes > MAX_DESCRIPTION_BYTES;

  function applyWrap(before: string, after: string, placeholder: string) {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const result = wrapSelection(textarea, before, after, placeholder);
    onChange(result.value);
    requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(result.selStart, result.selEnd);
    });
  }

  function applyLinePrefix(prefix: string) {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const result = insertAtLineStart(textarea, prefix);
    onChange(result.value);
    requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(result.selStart, result.selEnd);
    });
  }

  // Загрузка картинки описания (§3.2, POST /models/:id/description-images) — вставляет
  // ![alt](url) в позицию каретки, url достроен apiAssetUrl() (веб/API — разные поддомены).
  async function handleImagePicked(fileList: FileList | null) {
    const picked = fileList?.[0] ?? null;
    if (imageInputRef.current) imageInputRef.current.value = "";
    if (!picked || !modelId || imageUploading) return;
    setImageError(null);
    setImageUploading(true);
    try {
      const uploaded = await uploadImage(modelId, picked);
      const url = apiAssetUrl(uploaded.url);
      const alt = picked.name.replace(/\.[^.]+$/, "");
      const textarea = textareaRef.current;
      if (textarea) {
        const result = insertAtCursor(textarea, `![${alt}](${url})`);
        onChange(result.value);
        requestAnimationFrame(() => {
          textarea.focus();
          textarea.setSelectionRange(result.selStart, result.selEnd);
        });
      } else {
        onChange(`${value}${value ? "\n" : ""}![${alt}](${url})`);
      }
    } catch (err) {
      const code = err instanceof DescriptionImageError ? err.code : "unknown";
      setImageError(IMAGE_ERROR_MESSAGES[code]);
    } finally {
      setImageUploading(false);
    }
  }

  return (
    <div className="marketField">
      <label className="marketFieldLabel" htmlFor={id}>
        {fieldLabel}
      </label>
      <div className="mdEditor">
        <div className="mdToolbar" role="toolbar" aria-label="Форматирование" aria-controls={id}>
          <div className="mdToolbarButtons">
            <Tooltip content="Жирный текст">
              <button type="button" className="mdToolbarBtn pressable" aria-label="Жирный текст" title="Жирный" onClick={() => applyWrap("**", "**", "жирный")} disabled={disabled}>
                <strong>Ж</strong>
              </button>
            </Tooltip>
            <Tooltip content="Курсив">
              <button type="button" className="mdToolbarBtn pressable" aria-label="Курсив" title="Курсив" onClick={() => applyWrap("*", "*", "курсив")} disabled={disabled}>
                <em>К</em>
              </button>
            </Tooltip>
            <Tooltip content="Вставить код">
              <button type="button" className="mdToolbarBtn pressable" aria-label="Вставить код" title="Код" onClick={() => applyWrap("`", "`", "код")} disabled={disabled}>
                ‹/›
              </button>
            </Tooltip>
            <Tooltip content="Маркированный список">
              <button type="button" className="mdToolbarBtn pressable" aria-label="Маркированный список" title="Список" onClick={() => applyLinePrefix("- ")} disabled={disabled}>
                •
              </button>
            </Tooltip>
            <Tooltip content="Нумерованный список">
              <button type="button" className="mdToolbarBtn pressable" aria-label="1. — нумерованный список" title="Нумерованный список" onClick={() => applyLinePrefix("1. ")} disabled={disabled}>
                1.
              </button>
            </Tooltip>
            <Tooltip content="Добавить заголовок">
              <button type="button" className="mdToolbarBtn pressable" aria-label="Добавить заголовок" title="Заголовок" onClick={() => applyLinePrefix("## ")} disabled={disabled}>
                H
              </button>
            </Tooltip>
            <Tooltip content="Добавить ссылку">
              <button type="button" className="mdToolbarBtn pressable" aria-label="Добавить ссылку" title="Ссылка" onClick={() => applyWrap("[", "](https://)", "текст")} disabled={disabled}>
                🔗
              </button>
            </Tooltip>
            <Tooltip content={modelId ? "Добавить картинку: PNG, JPEG, GIF или WebP, до 10 МБ" : imageDisabledHint}>
              <button
                type="button"
                className="mdToolbarBtn pressable"
                aria-label="Добавить картинку"
                title={modelId ? "Картинка" : imageDisabledHint}
                onClick={() => imageInputRef.current?.click()}
                disabled={disabled || !modelId || imageUploading}
              >
                {imageUploading ? "…" : "🖼"}
              </button>
            </Tooltip>
            <input
              ref={imageInputRef}
              type="file"
              accept={IMAGE_ACCEPT}
              style={{ display: "none" }}
              onChange={(event) => void handleImagePicked(event.target.files)}
            />
          </div>
          {showByteCounter ? (
            <span className="mdCounter" data-over={overLimit || undefined}>
              {formatKb(bytes)}/50 КБ
            </span>
          ) : null}
        </div>

        {showPreview ? (
          <div className="mdTabs">
            <Chip selected={tab === "edit"} onClick={() => setTab("edit")}>
              Редактор
            </Chip>
            <Chip selected={tab === "preview"} onClick={() => setTab("preview")}>
              Предпросмотр
            </Chip>
          </div>
        ) : null}

        {helperText ? (
          <div id={`${id}-help`} className="mdHelper">
            {helperText}
          </div>
        ) : null}

        {!showPreview || tab === "edit" ? (
          <textarea
            id={id}
            ref={textareaRef}
            className="marketTextarea mdTextarea"
            value={value}
            onChange={(event) => onChange(event.target.value)}
            rows={6}
            disabled={disabled}
            aria-describedby={helperText ? `${id}-help` : undefined}
            placeholder={
              placeholder ??
              "Опишите проект: как печатать или собирать, настройки, материалы. Поддерживается Markdown — заголовки, списки, таблицы, код, ссылки, картинки."
            }
          />
        ) : (
          <div className="mdPreview" data-empty={!value.trim() || undefined}>
            {value.trim() ? <MarkdownBody source={value} /> : "Нечего показать — начните печатать в «Редакторе»."}
          </div>
        )}
      </div>
      {overLimit ? <div className="marketFieldError">Описание длиннее 50 КБ, сократите.</div> : null}
      {imageError ? <div className="marketFieldError">{imageError}</div> : null}
    </div>
  );
}
