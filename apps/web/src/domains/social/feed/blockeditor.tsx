import { useEffect, useRef, useState } from "react";
import type { SessionUser } from "@shared/types";
// eslint-disable-next-line boundaries/element-types -- легатное междоменное ребро (микроэтап 7.6): рантайм-зависимость, не тип/utility; развязка отложена до pages/DI-этапа. См. apps/web/MIGRATION.md.
import { listModels, type MarketModel } from "@domains/commerce";
import type { OverlayApi } from "@platform/overlay";
import { parseFeedBlocks, parseFeedEmbed, serializeFeedBlocks, type FeedBlock, type FeedBlockType } from "./blockcodec.ts";

const BLOCK_TYPES: ReadonlyArray<{ type: FeedBlockType; label: string; glyph: string }> = [
  { type: "text", label: "Текст", glyph: "T" },
  { type: "heading-2", label: "Подзаголовок 2", glyph: "H2" },
  { type: "heading-3", label: "Подзаголовок 3", glyph: "H3" },
  { type: "bullet-list", label: "Маркированный список", glyph: "•" },
  { type: "number-list", label: "Нумерованный список", glyph: "1." },
  { type: "quote", label: "Цитата", glyph: "“" },
  { type: "code", label: "Код", glyph: "</>" },
  { type: "image", label: "Фото", glyph: "▧" },
  { type: "model", label: "3D-модель", glyph: "◇" },
  { type: "project", label: "Проект", glyph: "⌂" },
  { type: "gitverse", label: "GitVerse", glyph: "⌘" },
];

function blockLabel(type: FeedBlockType): string {
  return BLOCK_TYPES.find((option) => option.type === type)?.label ?? "Текст";
}

function isRichBlock(type: FeedBlockType): boolean {
  return type === "image" || type === "model" || type === "project" || type === "gitverse";
}

function ModelPicker({
  user,
  kind,
  onPick,
}: {
  user: SessionUser;
  kind: "model" | "project";
  onPick: (model: MarketModel) => void;
}) {
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<MarketModel[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void listModels(query.trim() ? { q: query.trim(), limit: 20 } : { owner: user.username, limit: 20 }).then((page) => {
        if (!cancelled) setItems(page?.models ?? []);
      });
    }, query ? 180 : 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query, user.username]);

  return (
    <div className="feedInlinePicker">
      <input
        className="marketInput"
        value={query}
        autoFocus
        aria-label={`Найти ${kind === "model" ? "3D-модель" : "проект"}`}
        placeholder={kind === "model" ? "Название модели…" : "Название проекта…"}
        onChange={(event) => setQuery(event.target.value)}
      />
      <p>{query ? "Поиск по каталогу" : "Сначала — ваши работы"}</p>
      <div className="feedInlinePickerList">
        {items === null ? <span>Загрузка…</span> : null}
        {items?.map((model) => (
          <button type="button" className="feedInlinePickerRow pressable" key={model.id} onClick={() => onPick(model)}>
            {model.thumb_url ? <img src={model.thumb_url} alt="" /> : <span className="feedInlinePickerEmpty" aria-hidden="true">◇</span>}
            <span><strong>{model.title}</strong><small>@{model.owner.username}</small></span>
          </button>
        ))}
        {items?.length === 0 ? <span>Ничего не нашлось</span> : null}
      </div>
    </div>
  );
}

export function FeedBlockEditor({
  id,
  value,
  onChange,
  user,
  overlay,
  uploadImage,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  user?: SessionUser;
  overlay?: OverlayApi;
  uploadImage?: (file: File) => Promise<{ url: string }>;
}) {
  const [blocks, setBlocks] = useState<FeedBlock[]>(() => parseFeedBlocks(value));
  const [menuOpen, setMenuOpen] = useState(false);
  const [uploadingIndex, setUploadingIndex] = useState<number | null>(null);
  const newestBlockRef = useRef<HTMLTextAreaElement>(null);
  const imageInputRefs = useRef<Record<number, HTMLInputElement | null>>({});
  const previousBlockCount = useRef(blocks.length);

  useEffect(() => {
    const serialized = serializeFeedBlocks(blocks);
    if (value !== serialized) setBlocks(parseFeedBlocks(value));
  }, [blocks, value]);

  useEffect(() => {
    if (blocks.length > previousBlockCount.current) newestBlockRef.current?.focus();
    previousBlockCount.current = blocks.length;
  }, [blocks.length]);

  function commit(nextBlocks: FeedBlock[]) {
    setBlocks(nextBlocks);
    onChange(serializeFeedBlocks(nextBlocks));
  }

  function updateBlock(index: number, content: string) {
    commit(blocks.map((block, blockIndex) => (blockIndex === index ? { ...block, content } : block)));
  }

  function addBlock(type: FeedBlockType) {
    const content = isRichBlock(type) ? JSON.stringify({ kind: type }) : "";
    commit([...blocks, { type, content }]);
    setMenuOpen(false);
  }

  function removeBlock(index: number) {
    const nextBlocks = blocks.filter((_, blockIndex) => blockIndex !== index);
    commit(nextBlocks.length ? nextBlocks : [{ type: "text", content: "" }]);
  }

  function openModelPicker(index: number, kind: "model" | "project") {
    if (!user || !overlay) return;
    const handle = overlay.modal({
      title: kind === "model" ? "Вставить 3D-модель" : "Вставить проект",
      content: (
        <ModelPicker
          user={user}
          kind={kind}
          onPick={(model) => {
            updateBlock(index, JSON.stringify({
              kind,
              id: model.id,
              title: model.title,
              thumbUrl: model.thumb_url,
            }));
            handle.close();
          }}
        />
      ),
    });
  }

  async function handleImagePicked(index: number, files: FileList | null) {
    const file = files?.[0] ?? null;
    const input = imageInputRefs.current[index];
    if (input) input.value = "";
    if (!file || !uploadImage || uploadingIndex !== null) return;
    setUploadingIndex(index);
    try {
      const uploaded = await uploadImage(file);
      updateBlock(index, JSON.stringify({
        kind: "image",
        url: uploaded.url,
        title: file.name.replace(/\.[^.]+$/, ""),
      }));
    } catch {
      overlay?.toast({ severity: "critical", title: "Не удалось загрузить фото" });
    } finally {
      setUploadingIndex(null);
    }
  }

  function renderRichBlock(block: FeedBlock, index: number) {
    const data = parseFeedEmbed(block.content) ?? { kind: block.type as "image" | "model" | "project" | "gitverse" };
    if (block.type === "image") {
      return (
        <div className="feedInlineBlock" data-ready={data.url ? "true" : undefined}>
          {data.url ? <img className="feedInlineBlockImage" src={data.url} alt={data.title || ""} /> : <span className="feedInlineBlockGlyph" aria-hidden="true">▧</span>}
          <span className="feedInlineBlockCopy">
            <strong>{data.title || (uploadingIndex === index ? "Загружаем фото…" : "Фото в тексте")}</strong>
            <small>{data.url ? "Будет показано на всю ширину статьи" : "PNG, JPEG, WebP или GIF"}</small>
          </span>
          <button
            type="button"
            className="modelGlassBtn pressable"
            disabled={!uploadImage || uploadingIndex === index}
            onClick={() => imageInputRefs.current[index]?.click()}
          >
            {data.url ? "Заменить" : "Выбрать"}
          </button>
          <input
            ref={(node) => { imageInputRefs.current[index] = node; }}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            hidden
            onChange={(event) => void handleImagePicked(index, event.target.files)}
          />
        </div>
      );
    }
    if (block.type === "model" || block.type === "project") {
      const kind = block.type;
      const label = kind === "model" ? "3D-модель" : "Проект";
      return (
        <div className="feedInlineBlock" data-ready={data.id ? "true" : undefined}>
          {data.thumbUrl ? <img className="feedInlineBlockImage" src={data.thumbUrl} alt="" /> : <span className="feedInlineBlockGlyph" aria-hidden="true">{kind === "model" ? "◇" : "⌂"}</span>}
          <span className="feedInlineBlockCopy">
            <strong>{data.title || label}</strong>
            <small>{data.id ? "Встроенная карточка готова" : `Выберите ${kind === "model" ? "модель из каталога" : "работу из ваших проектов"}`}</small>
          </span>
          <button type="button" className="modelGlassBtn pressable" disabled={!user || !overlay} onClick={() => openModelPicker(index, kind)}>
            {data.id ? "Заменить" : "Выбрать"}
          </button>
        </div>
      );
    }
    return (
      <div className="feedInlineBlock feedInlineBlockGitverse" data-ready={data.url ? "true" : undefined}>
        <span className="feedInlineBlockGlyph" aria-hidden="true">⌘</span>
        <label className="feedInlineBlockCopy">
          <strong>GitVerse</strong>
          <input
            className="feedInlineUrlInput"
            aria-label={`Ссылка GitVerse блока ${index + 1}`}
            value={data.url ?? ""}
            placeholder="https://gitverse.ru/owner/repo/tree/main/folder"
            onChange={(event) => updateBlock(index, JSON.stringify({
              kind: "gitverse",
              url: event.target.value,
              title: event.target.value.split("/").filter(Boolean).slice(-2).join(" / "),
            }))}
          />
        </label>
      </div>
    );
  }

  return (
    <section className="feedBlockEditor" aria-labelledby={`${id}-label`}>
      <div className="feedBlockEditorHeader">
        <span id={`${id}-label`} className="marketFieldLabel">
          Содержание <span className="feedEditorOptional">(необязательно)</span>
        </span>
        <span className="feedBlockEditorHint">Markdown, фото, 3D и репозитории — в одном рассказе</span>
      </div>

      <div className="feedBlockEditorCanvas">
        {blocks.map((block, index) => (
          <div className="feedBlockRow" data-block-type={block.type} key={`${index}-${block.type}`}>
            <span className="feedBlockType" aria-hidden="true">
              {BLOCK_TYPES.find((option) => option.type === block.type)?.glyph}
            </span>
            {isRichBlock(block.type) ? renderRichBlock(block, index) : (
              <textarea
                id={index === 0 ? id : undefined}
                ref={index === blocks.length - 1 ? newestBlockRef : undefined}
                className="feedBlockInput"
                aria-label={`${blockLabel(block.type)} ${index + 1}`}
                value={block.content}
                rows={block.type === "text" ? 3 : 1}
                placeholder={block.type === "text" ? "Начните свой рассказ…" : blockLabel(block.type)}
                onChange={(event) => updateBlock(index, event.target.value)}
              />
            )}
            {blocks.length > 1 ? (
              <button
                type="button"
                className="feedBlockRemove pressable"
                aria-label={`Удалить блок ${index + 1}`}
                onClick={() => removeBlock(index)}
              >
                ×
              </button>
            ) : null}
          </div>
        ))}

        <div className="feedBlockAdd">
          <button
            type="button"
            className="feedBlockAddButton pressable"
            aria-label="Добавить блок"
            aria-expanded={menuOpen}
            aria-controls={`${id}-menu`}
            onClick={() => setMenuOpen((open) => !open)}
          >
            <span aria-hidden="true">+</span>
            Вставить в рассказ
          </button>
          {menuOpen ? (
            <div id={`${id}-menu`} className="feedBlockMenu" role="menu" aria-label="Тип нового блока">
              {BLOCK_TYPES.map((option) => (
                <button
                  type="button"
                  role="menuitem"
                  className="feedBlockMenuItem pressable"
                  key={option.type}
                  onClick={() => addBlock(option.type)}
                >
                  <span aria-hidden="true">{option.glyph}</span>
                  {option.label}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
