import { useEffect, useRef, useState, type ReactNode } from "react";
import type { SessionUser } from "@shared/types";
// eslint-disable-next-line boundaries/element-types -- легатное междоменное ребро (микроэтап 7.6): рантайм-зависимость, не тип/utility; развязка отложена до pages/DI-этапа. См. apps/web/MIGRATION.md.
import { listModels, type MarketModel } from "@domains/commerce";
import type { OverlayApi } from "@platform/overlay";
import { parseGitverseAttachment, type FeedGitverseRef } from "./api.ts";
import "./feed.css";
import { GitverseCardBody } from "./postcard.tsx";

// PostAttachmentPicker (feed.post.editor.md §2.6/§7.3): понятные табы формата публикации.
// Вложения взаимоисключающие, а доменный тип (model_link|media|gitverse|text) по-прежнему
// выводится из выбранного вложения, не хранится отдельным значением формы.

export type PostAttachment =
  | { kind: "model"; modelId: string; title: string; thumbUrl: string | null }
  | { kind: "media"; file: File; previewUrl: string; isVideo: boolean; posterFile: File | null; posterUrl: string | null }
  | { kind: "gitverse"; url: string; repo: FeedGitverseRef | null; parseFailed: boolean };

function ModelSearchModal({
  user,
  overlay,
  onPick,
  onClose,
}: {
  user: SessionUser;
  overlay: OverlayApi;
  onPick: (model: MarketModel) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<MarketModel[] | null>(null);
  const [loading, setLoading] = useState(true);

  async function search(query: string) {
    setLoading(true);
    const page = query.trim()
      ? await listModels({ q: query.trim(), limit: 20 })
      : await listModels({ owner: user.id, limit: 20 });
    setLoading(false);
    if (!page) {
      overlay.toast({ severity: "critical", title: "Не удалось загрузить модели" });
      setResults([]);
      return;
    }
    setResults(page.models);
  }

  useEffect(() => {
    void search("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, minWidth: 320 }}>
      <input
        className="marketInput"
        placeholder="Поиск моделей…"
        value={q}
        autoFocus
        onChange={(event) => {
          const value = event.target.value;
          setQ(value);
          void search(value);
        }}
      />
      {loading ? (
        <div style={{ color: "var(--text-dim)", fontSize: 14 }}>Загрузка…</div>
      ) : results && results.length > 0 ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 4, maxHeight: 360, overflowY: "auto" }}>
          {results.map((model) => (
            <button
              type="button"
              key={model.id}
              className="feedModelSearchRow pressable"
              onClick={() => {
                onPick(model);
                onClose();
              }}
            >
              {model.thumb_url ? <img className="feedModelSearchThumb" src={model.thumb_url} alt="" /> : <span className="feedModelSearchThumb" />}
              <span style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{model.title}</span>
                <span style={{ fontSize: 12, color: "var(--text-dim)" }}>@{model.owner.username}</span>
              </span>
            </button>
          ))}
        </div>
      ) : (
        <div style={{ color: "var(--text-dim)", fontSize: 14 }}>Ничего не нашлось.</div>
      )}
    </div>
  );
}

const MEDIA_ACCEPT = "image/png,image/jpeg,image/webp,image/gif,video/mp4,video/webm";
const POSTER_ACCEPT = "image/png,image/jpeg,image/webp";

// «Прикрепить GitVerse» (feed.post.editor.md §2.6, MF-1051) — не модалка, инлайн `Input` под
// рядом кнопок. На blur/Enter парсим метаданные, спиннер внутри поля на время запроса.
function GitverseInlineField({ onAttach }: { onAttach: (attachment: PostAttachment) => void }) {
  const [url, setUrl] = useState("");
  const [parsing, setParsing] = useState(false);
  const committedRef = useRef(false);

  async function commit() {
    const trimmed = url.trim();
    if (!trimmed || committedRef.current) return;
    committedRef.current = true;
    setParsing(true);
    const repo = await parseGitverseAttachment(trimmed);
    setParsing(false);
    onAttach({ kind: "gitverse", url: trimmed, repo, parseFailed: repo === null });
  }

  return (
    <div className="feedEditorGitverseField">
      <input
        className="marketInput"
        aria-label="Ссылка на репозиторий GitVerse"
        placeholder="https://gitverse.ru/owner/repo"
        value={url}
        autoFocus
        disabled={parsing}
        onChange={(event) => setUrl(event.target.value)}
        onBlur={() => void commit()}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            void commit();
          }
        }}
      />
      {parsing ? <span className="feedEditorGitverseSpinner" aria-hidden="true" /> : null}
    </div>
  );
}

export function PostAttachmentPicker({
  user,
  overlay,
  attachment,
  onChange,
  label = "Обложка карточки",
}: {
  user: SessionUser;
  overlay: OverlayApi;
  attachment: PostAttachment | null;
  onChange: (attachment: PostAttachment | null) => void;
  label?: string;
}) {
  const mediaInputRef = useRef<HTMLInputElement>(null);
  const posterInputRef = useRef<HTMLInputElement>(null);
  const [gitverseFieldOpen, setGitverseFieldOpen] = useState(false);

  function openModelSearch() {
    const handle = overlay.modal({
      title: "Прикрепить модель",
      content: (
        <ModelSearchModal
          user={user}
          overlay={overlay}
          onClose={() => handle.close()}
          onPick={(model) =>
            onChange({ kind: "model", modelId: model.id, title: model.title, thumbUrl: model.thumb_url })
          }
        />
      ),
    });
  }

  function handleMediaPicked(fileList: FileList | null) {
    const file = fileList?.[0] ?? null;
    if (mediaInputRef.current) mediaInputRef.current.value = "";
    if (!file) return;
    const isVideo = file.type.startsWith("video/");
    onChange({ kind: "media", file, previewUrl: URL.createObjectURL(file), isVideo, posterFile: null, posterUrl: null });
  }

  function handlePosterPicked(fileList: FileList | null) {
    const file = fileList?.[0] ?? null;
    if (posterInputRef.current) posterInputRef.current.value = "";
    if (!file || !attachment || attachment.kind !== "media") return;
    onChange({ ...attachment, posterFile: file, posterUrl: URL.createObjectURL(file) });
  }

  const activeType = attachment?.kind ?? (gitverseFieldOpen ? "gitverse" : "text");
  const typeTabs = (
    <div className="feedEditorTypeTabs" role="tablist" aria-label="Тип публикации">
      <button
        type="button"
        role="tab"
        aria-selected={activeType === "text"}
        className="feedEditorTypeTab pressable"
        onClick={() => {
          setGitverseFieldOpen(false);
          onChange(null);
        }}
      >
        <span aria-hidden="true">✎</span> Текст
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={activeType === "media"}
        className="feedEditorTypeTab pressable"
        onClick={() => mediaInputRef.current?.click()}
      >
        <span aria-hidden="true">▧</span> Фото и видео
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={activeType === "model"}
        className="feedEditorTypeTab pressable"
        onClick={openModelSearch}
      >
        <span aria-hidden="true">◇</span> 3D-модель
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={activeType === "gitverse"}
        className="feedEditorTypeTab pressable"
        onClick={() => {
          if (attachment) onChange(null);
          setGitverseFieldOpen(true);
        }}
      >
        <span aria-hidden="true">⌘</span> GitVerse
      </button>
      <input
        ref={mediaInputRef}
        type="file"
        accept={MEDIA_ACCEPT}
        style={{ display: "none" }}
        onChange={(event) => handleMediaPicked(event.target.files)}
      />
    </div>
  );

  let attachmentContent: ReactNode = null;
  if (attachment?.kind === "gitverse") {
    attachmentContent = (
      <div className="feedEditorAttachPreview feedEditorAttachPreviewGitverse">
        <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <GitverseCardBody url={attachment.url} repo={attachment.repo} />
          </div>
          <button
            type="button"
            className="modelGlassBtn pressable feedEditorAttachRemove"
            aria-label="Снять вложение"
            onClick={() => onChange(null)}
          >
            ×
          </button>
        </div>
        {attachment.parseFailed ? <span style={{ color: "var(--text-dim)", fontSize: 12 }}>Превью не загрузилось, ссылка сохранена</span> : null}
      </div>
    );
  } else if (attachment) {
    attachmentContent = (
      <div className="feedEditorAttachPreview">
        {attachment.kind === "model" ? (
          <>
            {attachment.thumbUrl ? <img className="feedEditorAttachPreviewThumb" src={attachment.thumbUrl} alt="" /> : null}
            <span>{attachment.title}</span>
          </>
        ) : (
          <>
            {attachment.isVideo ? (
              <video className="feedEditorAttachPreviewThumb" src={attachment.previewUrl} muted />
            ) : (
              <img className="feedEditorAttachPreviewThumb" src={attachment.previewUrl} alt="" />
            )}
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <span>{attachment.file.name}</span>
              {attachment.isVideo ? (
                <>
                  <button type="button" className="modelGlassBtn pressable" onClick={() => posterInputRef.current?.click()}>
                    {attachment.posterUrl ? "Заменить обложку" : "Добавить обложку"}
                  </button>
                  <input
                    ref={posterInputRef}
                    type="file"
                    accept={POSTER_ACCEPT}
                    style={{ display: "none" }}
                    onChange={(event) => handlePosterPicked(event.target.files)}
                  />
                </>
              ) : null}
            </div>
          </>
        )}
        <button
          type="button"
          className="modelGlassBtn pressable feedEditorAttachRemove"
          aria-label="Снять вложение"
          onClick={() => onChange(null)}
        >
          ×
        </button>
      </div>
    );
  } else if (gitverseFieldOpen) {
    attachmentContent = (
      <GitverseInlineField
        onAttach={(picked) => {
          setGitverseFieldOpen(false);
          onChange(picked);
        }}
      />
    );
  }

  return (
    <div className="feedEditorAttachmentPicker">
      <div className="feedEditorAttachmentLabel">
        <span>{label}</span>
        <small>Главный объект, который увидят в ленте</small>
      </div>
      {typeTabs}
      {attachmentContent}
    </div>
  );
}
