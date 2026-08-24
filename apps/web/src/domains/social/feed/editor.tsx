import { useEffect, useRef, useState } from "react";
import type { SessionUser } from "@shared/types";
import { AvatarBubble, DEFAULT_AVATAR, deterministicAvatarConfig } from "@shared/avatar";
// eslint-disable-next-line boundaries/element-types, boundaries/entry-point -- легатное ребро (Этап 4.5): CSS side-effect, не index.ts; home.css остаётся общим "рабочим хромом" для доменных экранов, развязка отложена до pages/DI (Этап 10). См. MIGRATION.md.
import "@pages/home/home.css";
import { HomeHeader, type Section } from "@platform/nav";
// eslint-disable-next-line boundaries/element-types -- легатное междоменное ребро (микроэтап 7.6): рантайм-зависимость, не тип/utility; развязка отложена до pages/DI-этапа. См. apps/web/MIGRATION.md.
import { getModel } from "@domains/commerce";
import { apiAssetUrl } from "@shared/api";
import { useOverlay } from "@platform/overlay";
import { feedPath, feedPostPath, headerModeFor, navigate } from "../../../router.ts";
import { AuroraBackground, Card, Eyebrow, Heading } from "@shared/ui";
import {
  createFeedPost,
  listMyCommunities,
  parseGitverseAttachment,
  uploadFeedMedia,
  type FeedCommunityOption,
  type FeedPost,
} from "./api.ts";
import { PostAttachmentPicker, type PostAttachment } from "./attachmentpicker.tsx";
import { hasFeedBlockContent } from "./blockcodec.ts";
import { FeedBlockEditor } from "./blockeditor.tsx";
import { clearDraft, loadDraft, saveDraft, type FeedDraft } from "./draft.ts";
import { trackFeedEvent } from "./events.ts";
import "./feed.css";

// Редактор /feed/new (docs/design/feed.post.editor.md §2). headerMode:'light', "←" = "Отмена"
// без confirm() — черновик уже в localStorage, терять нечего (§0).

const MAX_BODY_BYTES = 50 * 1024;
const TITLE_MAX_LENGTH = 120;
const TITLE_COUNTER_THRESHOLD = 100;
const AUTOSAVE_INTERVAL_MS = 2000;

function byteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

function attachmentToDraft(attachment: PostAttachment | null): FeedDraft["attachment"] {
  if (!attachment) return null;
  if (attachment.kind === "model") return { kind: "model", modelId: attachment.modelId, title: attachment.title, thumbUrl: attachment.thumbUrl };
  if (attachment.kind === "gitverse") return { kind: "gitverse", url: attachment.url };
  return { kind: "media-placeholder", fileName: attachment.file.name };
}

export function FeedEditorScreen({
  user,
  section,
  onSectionChange,
  modelId,
}: {
  user: SessionUser;
  section: Section;
  onSectionChange: (section: Section) => void;
  // Предзаполнение вложения модели («Рассказать в ленте», §2.1 п.4, ?model=:id).
  modelId?: string;
}) {
  const overlay = useOverlay();
  const restoredRef = useRef(false);
  const draftStartedRef = useRef(false);
  const titleRef = useRef<HTMLInputElement>(null);
  const [communities, setCommunities] = useState<FeedCommunityOption[]>([]);
  const [communityId, setCommunityId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [attachment, setAttachment] = useState<PostAttachment | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [showRestoredBanner, setShowRestoredBanner] = useState(false);
  const [titleAttempted, setTitleAttempted] = useState(false);

  useEffect(() => {
    void listMyCommunities().then(setCommunities);
  }, []);

  // Восстановление черновика (§2.8) — тихое (форма уже заполнена), баннер только информирует.
  useEffect(() => {
    if (restoredRef.current) return;
    restoredRef.current = true;
    const draft = loadDraft();
    if (!draft) return;
    setCommunityId(draft.communityId);
    setTitle(draft.title);
    setBody(draft.body);
    if (draft.attachment?.kind === "model" && draft.attachment.modelId) {
      setAttachment({ kind: "model", modelId: draft.attachment.modelId, title: draft.attachment.title ?? "", thumbUrl: draft.attachment.thumbUrl ?? null });
    } else if (draft.attachment?.kind === "gitverse" && draft.attachment.url) {
      const url = draft.attachment.url;
      setAttachment({ kind: "gitverse", url, repo: null, parseFailed: false });
      void parseGitverseAttachment(url).then((repo) => {
        setAttachment((prev) => (prev?.kind === "gitverse" && prev.url === url ? { kind: "gitverse", url, repo, parseFailed: repo === null } : prev));
      });
    }
    setShowRestoredBanner(true);
  }, []);

  // Предзаполнение с карточки модели (?model=:id, §2.3) — только если черновик не принёс своё
  // вложение (черновик приоритетнее одноразового query-параметра).
  useEffect(() => {
    if (!modelId || attachment) return;
    void getModel(modelId).then((model) => {
      if (model) setAttachment({ kind: "model", modelId: model.id, title: model.title, thumbUrl: model.thumb_url });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelId]);

  // Автосейв ~2с (§2.8).
  useEffect(() => {
    const timer = setInterval(() => {
      const draft: FeedDraft = { communityId, title, body, attachment: attachmentToDraft(attachment) };
      if (draft.title || draft.body || draft.attachment) saveDraft(draft);
    }, AUTOSAVE_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [communityId, title, body, attachment]);

  // feed_post_draft_start (feed.page.md, MF-823/MF-980) — первый keystroke заголовка/тела или
  // первое вложение в этом заходе на /feed/new. Ref-флаг, не state — событие best-effort, не
  // должно вызывать лишний рендер; восстановление черновика (эффект выше) не идёт через эти
  // onChange-хендлеры, поэтому не считается "стартом" повторно.
  function markDraftStarted() {
    if (draftStartedRef.current) return;
    draftStartedRef.current = true;
    trackFeedEvent("feed_post_draft_start", { community_id: communityId });
  }

  function handleStartOver() {
    clearDraft();
    draftStartedRef.current = false;
    setCommunityId(null);
    setTitle("");
    setBody("");
    setAttachment(null);
    setShowRestoredBanner(false);
    setTitleAttempted(false);
  }

  const bodyBytes = byteLength(body);
  const posterMissing = attachment?.kind === "media" && attachment.isVideo && !attachment.posterFile;
  const disabledReason = !title.trim()
    ? "Введите заголовок"
    : title.length > TITLE_MAX_LENGTH
      ? "Заголовок — до 120 символов"
      : bodyBytes > MAX_BODY_BYTES
        ? "Текст длиннее 50 КБ, сократите"
        : posterMissing
          ? "Добавьте обложку видео"
          : !hasFeedBlockContent(body) && !attachment
            ? "Добавьте текст или вложение"
            : null;

  async function handlePublish() {
    if (publishing) return;
    if (!title.trim()) {
      setTitleAttempted(true);
      titleRef.current?.focus();
      return;
    }
    if (disabledReason) return;
    setPublishing(true);
    try {
      let mediaS3Key: string | undefined;
      if (attachment?.kind === "media") {
        const uploaded = await uploadFeedMedia(attachment.file);
        if (!uploaded) {
          overlay.toast({ severity: "critical", title: "Не удалось опубликовать. Попробуйте ещё раз" });
          return;
        }
        mediaS3Key = uploaded.s3_key;
      }
      const created: FeedPost | null = await createFeedPost({
        type: attachment?.kind === "model" ? "model_link" : attachment?.kind === "media" ? "media" : attachment?.kind === "gitverse" ? "gitverse" : "text",
        title: title.trim(),
        body: body.trim() || undefined,
        model_id: attachment?.kind === "model" ? attachment.modelId : undefined,
        media_s3_key: mediaS3Key,
        gitverse_url: attachment?.kind === "gitverse" ? attachment.url : undefined,
        community_id: communityId,
      });
      if (!created) {
        overlay.toast({ severity: "critical", title: "Не удалось опубликовать. Попробуйте ещё раз" });
        return;
      }
      clearDraft();
      overlay.toast({ severity: "success", title: "Опубликовано" });
      navigate(feedPostPath(created.id));
    } finally {
      setPublishing(false);
    }
  }

  const titleMissing = !title.trim();
  const showTitleError = titleAttempted && titleMissing;
  const selectedCommunity = communities.find((community) => community.id === communityId);

  return (
    <div className="home">
      <AuroraBackground />
      <div style={{ position: "relative", zIndex: 30 }}>
        <HomeHeader
          user={user}
          printers={[]}
          section={section}
          onSectionChange={onSectionChange}
          mode={headerModeFor("feed-new", { withBack: true })}
          onBack={() => navigate(feedPath())}
        />
      </div>
      <main className="homeContent homeWorkspaceBody feedEditorShell">
        <div className="feedEditorLayout">
          <section className="feedEditorPage">
          <div className="feedEditorHeading">
            <div>
              <Eyebrow>Новая публикация</Eyebrow>
              <Heading size="md">Расскажите, что сделали</Heading>
            </div>
            <span>Автосохранение включено</span>
          </div>

          <div className="feedEditorComposerHead">
            <div className="feedEditorContext" aria-live="polite">
              {selectedCommunity ? (
                <span className="feedEditorContextMark">{selectedCommunity.name[0]?.toUpperCase()}</span>
              ) : (
                <AvatarBubble config={deterministicAvatarConfig(user.username || user.id)} snapshots={null} size={44} facing="front" />
              )}
              <div>
                <strong>{selectedCommunity ? selectedCommunity.name : user.display_name || user.username}</strong>
                <span>{selectedCommunity ? `Сообщество · от @${user.username}` : `@${user.username} · в ваш профиль`}</span>
              </div>
            </div>
            <label className="feedEditorCommunity" htmlFor="feed-editor-community">
              <span>Куда публикуем</span>
              <select
                id="feed-editor-community"
                className="marketInput"
                value={communityId ?? ""}
                onChange={(event) => setCommunityId(event.target.value || null)}
              >
                <option value="">В мой профиль</option>
                {communities.map((community) => (
                  <option key={community.id} value={community.id}>
                    {community.name}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {showRestoredBanner ? (
            <div className="feedEditorDraftBanner">
              <span>Восстановлен черновик</span>
              <button type="button" onClick={handleStartOver}>
                Начать заново
              </button>
            </div>
          ) : null}

          <div className="marketField feedEditorTitleRow" data-invalid={showTitleError || undefined}>
            <label className="marketFieldLabel" htmlFor="feed-editor-title">
              Заголовок <span className="feedEditorRequired">*</span>
            </label>
            {title.length >= TITLE_COUNTER_THRESHOLD ? (
              <span className="feedEditorTitleCounter">
                {title.length}/{TITLE_MAX_LENGTH}
              </span>
            ) : null}
            <input
              id="feed-editor-title"
              ref={titleRef}
              className="marketInput"
              value={title}
              maxLength={TITLE_MAX_LENGTH}
              required
              aria-invalid={showTitleError}
              aria-describedby={showTitleError ? "feed-editor-title-error" : undefined}
              onChange={(event) => {
                markDraftStarted();
                setTitle(event.target.value);
                if (event.target.value.trim()) setTitleAttempted(false);
              }}
              placeholder="Дайте работе понятное название"
            />
            {showTitleError ? (
              <span id="feed-editor-title-error" className="feedEditorFieldError" role="alert">
                Заполните заголовок
              </span>
            ) : null}
          </div>

          <PostAttachmentPicker
            user={user}
            overlay={overlay}
            attachment={attachment}
            onChange={(next) => {
              markDraftStarted();
              setAttachment(next);
            }}
          />

          <FeedBlockEditor
            id="feed-editor-body"
            value={body}
            user={user}
            overlay={overlay}
            uploadImage={async (file) => {
              const uploaded = await uploadFeedMedia(file);
              if (!uploaded) throw new Error("upload");
              return { url: apiAssetUrl(uploaded.url) };
            }}
            onChange={(value) => {
              markDraftStarted();
              setBody(value);
            }}
          />
          <p className="feedEditorBodyLimit" role="status">
            {Math.ceil(bodyBytes / 1024)} из 50 КБ текста
          </p>

          <div className="feedEditorFooter">
            {disabledReason && !titleMissing ? <span className="feedEditorDisabledReason">{disabledReason}</span> : null}
            <button type="button" className="modelGlassBtn pressable" onClick={() => navigate(feedPath())}>
              Отмена
            </button>
            <button type="button" className="modelGlassBtn pressable" data-variant="primary" disabled={publishing} onClick={() => void handlePublish()}>
              {publishing ? "Публикация…" : "Опубликовать"}
            </button>
          </div>
          </section>

          <aside className="feedEditorAside" aria-label="Подсказки к публикации">
            <Card className="feedEditorGuide">
              <Eyebrow>Как в хорошей мастерской</Eyebrow>
              <Heading size="md">Покажите не только финал</Heading>
              <ol>
                <li><span>1</span><div><strong>С чего начали</strong><small>Задача, ограничения и первая версия.</small></div></li>
                <li><span>2</span><div><strong>Что сработало</strong><small>Материалы, настройки, код и удачные решения.</small></div></li>
                <li><span>3</span><div><strong>Что можно повторить</strong><small>Фото, 3D-модель, проект или папка GitVerse.</small></div></li>
              </ol>
            </Card>
            <Card className="feedEditorMascotTip">
              <AvatarBubble config={{ ...DEFAULT_AVATAR, pose: "think", accessory: "wrench" }} size={58} facing="right" />
              <div>
                <strong>Собирайте рассказ блоками</strong>
                <span>Как в X — начать легко. Как в Reddit — можно углубиться.</span>
              </div>
            </Card>
          </aside>
        </div>
      </main>
    </div>
  );
}
