import { useEffect, useRef, useState, type RefObject } from "react";
import type { SessionUser } from "@shared/types";
import { AvatarBubble, deterministicAvatarConfig } from "@shared/avatar";
import { relativeDate, hueFromId } from "@shared/lib";
import { apiAssetUrl } from "@shared/api";
import { communityPath, feedPostPath, modelPath, navigate, profilePath } from "../../../router.ts";
import { useInteractionSound } from "@platform/sound";
import { CardFooterActions, CubeIcon, Eyebrow, LetterboxImage } from "@shared/ui";
import { FEED_ORIGIN_KEY, type FeedAgentRef, type FeedModelRef, type FeedPost } from "./api.ts";
import {
  parseFeedBlocks,
  serializeFeedBlocks,
  stripEditorialClaimMarkers,
  type FeedBlock,
} from "./blockcodec.ts";

import { formatStars, GitverseCardBody } from "./gitversecard.tsx";
export { formatStars, GitverseCardBody };

import { FeedProvenance, resolveFeedPostProvenance } from "./provenance.tsx";
import { FeedRichBody } from "./richbody.tsx";
import { VoteArrows, type VoteArrowsProps } from "./vote.tsx";
import "./feed.css";

// Карточка поста ленты — один каркас, три тела (docs/design/feed.md §2). Переиспользуется тут
// (мини-превью редактора §2.7), на странице поста («Ещё из этого саба» §1.7) и (позже) полной
// лентой /feed (feed.md, отдельная карточка Front). Голосовалка/футер-пилюли — тот же язык, что
// зафиксировала feed.md; сама лента (три колонки, скоупы, сайдбары) — вне этой карточки (MF-816).

const TEN_MINUTES_MS = 10 * 60 * 1000;

export function isScoreApprox(post: FeedPost): boolean {
  if (post.score_approx !== undefined) return post.score_approx;
  return post.votes_up - post.votes_down !== 0 && Date.now() - new Date(post.created_at).getTime() < TEN_MINUTES_MS;
}

// Категория карточки (2026-07-21): type-специфичные лейблы (3D-проект/GitVerse/Напечатано/
// Новинка) остаются приоритетными — они описывают СТРУКТУРУ вложения точнее любой общей
// категории. Но для «безликих» типов (text/media) co_author_agent_id перекрывает generic
// "Обсуждение"/"Фотоотчёт" на "Новости" — агентский пост про анонс бренда это не личный
// фотоотчёт и не случайное обсуждение, даже если технически type=media с одной картинкой.
export function postKindLabel(post: FeedPost): string {
  if (post.type === "model_link") return "3D-проект";
  if (post.type === "gitverse") return "GitVerse";
  if (post.type === "make") return "Напечатано";
  if (post.type === "printer_announcement") return "Новинка";
  if (post.co_author_agent_id) return "Новости";
  if (post.type === "media") return post.media_kind === "image" ? "Фотоотчёт" : "Медиа";
  return "Обсуждение";
}

// Двойная подпись (MF-2028/MF-2030): показывается СРАЗУ рядом с человеком-автором, не вместо
// него — agents.and.humans.md § «Прозрачность авторства» требует, чтобы вклад агента был виден,
// не спрятан. title-тултип — bio/runtime_label, тот же принцип честности ("на чём это работает").
function CoAuthorBadge({ agent }: { agent: FeedAgentRef | null | undefined }) {
  if (!agent) return null;
  const title = [agent.bio, agent.runtime_label].filter(Boolean).join(" · ") || undefined;
  return (
    <span className="feedCoAuthorBadge" title={title}>
      <span aria-hidden="true">🤖</span>
      {agent.name}
    </span>
  );
}

function isOfficialCommunity(post: FeedPost): boolean {
  return Boolean(
    post.community &&
      (post.community.is_official || post.community.kind === "vendor" || post.community.kind === "machine"),
  );
}

function FeedPostIdentityMark({ post }: { post: FeedPost }) {
  if (post.author?.avatar_config) {
    return <AvatarBubble config={post.author.avatar_config} snapshots={post.author.avatar_snapshots} size={36} facing="front" />;
  }
  return (
    <AvatarBubble
      config={deterministicAvatarConfig(post.author?.username ?? post.author_id)}
      snapshots={null}
      size={36}
      facing="front"
    />
  );
}

// Plain-text сниппет из markdown (feed.md §2.2 — «заголовки/списки схлопнуты в текст»):
// достаточно грубого стриппинга разметки, это карточка списка, не рендер статьи.
export function markdownSnippet(source: string): string {
  return stripEditorialClaimMarkers(source)
    .replace(/<!-- portal:embed [\s\S]*?<!-- \/portal:embed -->/g, " ")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)]\([^)]*\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^[-*+]\s+/gm, "")
    .replace(/^\d+\.\s+/gm, "")
    .replace(/[*_`>#]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function ChatIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M4 5h16v11H8l-4 4V5Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ShareIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="18" cy="5" r="2.4" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="6" cy="12" r="2.4" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="18" cy="19" r="2.4" stroke="currentColor" strokeWidth="1.5" />
      <path d="M8.3 10.6 15.7 6.4M8.3 13.4l7.4 4.2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

// Тонкая line-иконка ▶ (feed.md §2.2 — «сигнализирует видео», не крупная play-кнопка
// на пол-карточки: контур, не заливка, компактный размер поверх постера).
function PlayIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.4" opacity="0.9" />
      <path d="M10 8.3v7.4l6.2-3.7L10 8.3Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
    </svg>
  );
}

function ChevronIcon({ expanded }: { expanded: boolean }) {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className="feedPillChevron"
      data-expanded={expanded || undefined}
    >
      <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}


// Компактная превью-плитка модели для тела `model_link` (feed.md §2.2) — переиспользует тот же
// слоёный псевдо-3D-стек, что каталог (`ModelTile`, market.tile.tsx), не рисует новый превью,
// просто в квадратной ~120×120 рамке вместо вертикальной карточки каталога.
function FeedModelPreviewTile({ model, modelId }: { model: FeedModelRef | null; modelId: string | null }) {
  const thumb = model?.thumb_url ?? null;
  return (
    <span
      className="feedPostCardModelPreview homeModelThumb"
      style={{ ["--tile-hue" as string]: hueFromId(modelId ?? model?.id ?? "") }}
      aria-hidden="true"
    >
      <span className="homeModelGlow" aria-hidden="true" />
      <span className={`homeModelArt${thumb ? " homeModelArt--photo" : ""}`}>
        <span className="homeModelLayer homeModelLayerBack" aria-hidden="true">
          {thumb ? <img className="homeModelPhoto" src={apiAssetUrl(thumb)} alt="" /> : <CubeIcon />}
        </span>
        <span className="homeModelLayer homeModelLayerFront">
          {thumb ? <img className="homeModelPhoto" src={apiAssetUrl(thumb)} alt="" /> : <CubeIcon />}
        </span>
      </span>
      <span className="homeModelShadow" aria-hidden="true" />
    </span>
  );
}

async function share(url: string, title: string) {
  if (typeof navigator.share === "function") {
    try {
      await navigator.share({ title, url });
    } catch {
      // отказ/отмена системного шита — тихо, тот же паттерн, что «Поделиться» модели
    }
    return;
  }
  try {
    await navigator.clipboard.writeText(url);
  } catch {
    // буфер обмена недоступен — тихо, ссылка всё равно в адресной строке после перехода
  }
}

export interface FeedEditorialSummary {
  lead: string;
  sections: string[];
  visualSource: string | null;
  structured: boolean;
}

function isVisualBlock(block: FeedBlock): boolean {
  if (block.type === "image" || block.type === "diagram") return true;
  // Старые/человеческие публикации могут содержать обычную markdown-картинку, ещё без
  // portal:embed. Она тоже должна попасть в превью карточки, а не исчезать из ленты.
  return block.type === "text" && /^!\[[^\]]*]\([^)]+\)\s*$/.test(block.content.trim());
}

export function editorialSummaryFromMarkdown(source: string): FeedEditorialSummary {
  const blocks = parseFeedBlocks(source).filter((block) => block.content.trim());
  const sections = blocks
    .filter((block) => block.type === "heading-2" || block.type === "heading-3")
    .map((block) => markdownSnippet(block.content))
    .filter(Boolean)
    .slice(0, 3);
  const visual = blocks.find(isVisualBlock) ?? null;
  const leadBlock = blocks.find((block) =>
    !isVisualBlock(block) && block.type !== "heading-2" && block.type !== "heading-3" && block.type !== "sources",
  );
  return {
    lead: leadBlock ? markdownSnippet(serializeFeedBlocks([leadBlock])) : "",
    sections,
    visualSource: visual ? serializeFeedBlocks([visual]) : null,
    structured: Boolean(visual || sections.length),
  };
}

function FeedEditorialPreview({ source }: { source: string }) {
  const summary = editorialSummaryFromMarkdown(source);
  if (!summary.structured) {
    return (
      <div className="feedPostCardSnippet" data-clamp={source.length > 200 || undefined}>
        {markdownSnippet(source)}
      </div>
    );
  }
  return (
    <div className="feedPostEditorial">
      {summary.lead ? <p className="feedPostEditorialLead">{summary.lead}</p> : null}
      {summary.visualSource ? (
        <div className="feedPostEditorialVisual" onClick={(event) => event.stopPropagation()}>
          <FeedRichBody source={summary.visualSource} />
        </div>
      ) : null}
      {summary.sections.length ? (
        <div className="feedPostEditorialSections" aria-label="Разделы материала">
          <span className="feedPostEditorialSectionsLabel">В материале</span>
          <ol>
            {summary.sections.map((section, index) => (
              <li key={`${section}-${index}`}>
                <span>{String(index + 1).padStart(2, "0")}</span>
                <strong>{section}</strong>
              </li>
            ))}
          </ol>
        </div>
      ) : null}
    </div>
  );
}

function FeedCardBody({ post }: { post: FeedPost }) {
  if (post.type === "model_link") {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <button
          type="button"
          className="feedPostCardModel"
          aria-label={post.model?.title ? `Открыть модель: ${post.model.title}` : "Открыть модель"}
          onClick={(event) => {
            event.stopPropagation();
            if (post.model_id) navigate(modelPath(post.model_id));
          }}
        >
          <FeedModelPreviewTile model={post.model ?? null} modelId={post.model_id} />
          <div className="feedPostCardModelCopy">
            <Eyebrow>{post.model ? "3D-модель" : "Модель"}</Eyebrow>
            <div className="feedPostCardModelTitle">
              {post.model?.title ?? "Модель недоступна"}
            </div>
            {post.model ? (
              <div className="feedPostCardModelStats">
                <span>♥ {post.model.votes_up}</span>
                <span>↓ {post.model.downloads_count} скачиваний</span>
              </div>
            ) : null}
            <span className="feedPostCardModelAction">Смотреть модель ↗</span>
          </div>
        </button>
        {post.body ? (
          <div className="feedPostCardSnippet" data-clamp="true" style={{ maxHeight: "2.6em" }}>
            {markdownSnippet(post.body)}
          </div>
        ) : null}
      </div>
    );
  }
  if (post.type === "media") {
    // MF-2035: play-иконка поверх превью раньше рисовалась безусловно — на фото (media_kind
    // "image") это лживая аффорданса «нажми — заиграет». Показываем только когда это реально
    // видео (или media_kind ещё не пришёл от старых записей — тогда исторически безопаснее
    // считать видео, тем же допущением, что раньше был единственный <video>-путь).
    const isPhoto = post.media_kind === "image";
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <LetterboxImage
          className="feedPostCardMedia"
          src={post.poster_url ? apiAssetUrl(post.poster_url) : post.media_url ? apiAssetUrl(post.media_url) : null}
        >
          {isPhoto ? null : (
            <div className="feedPostCardMediaPlay" aria-hidden="true">
              <PlayIcon />
            </div>
          )}
        </LetterboxImage>
        {post.body ? (
          <div className="feedPostCardSnippet feedPostCardSnippetMedia">{markdownSnippet(post.body)}</div>
        ) : null}
      </div>
    );
  }
  if (post.type === "gitverse") {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <GitverseCardBody url={post.gitverse_url ?? null} repo={post.gitverse ?? null} />
        {post.body ? (
          <div className="feedPostCardSnippet" data-clamp="true" style={{ maxHeight: "2.6em" }}>
            {markdownSnippet(post.body)}
          </div>
        ) : null}
      </div>
    );
  }
  return post.body ? <FeedEditorialPreview source={post.body} /> : null;
}

// Есть ли что раскрывать инлайн-pill'ой (feed.md §2.4 — «появляется только когда есть что
// раскрывать»): по типу тела, таблица §2.4.
function hasExpandableContent(post: FeedPost): boolean {
  if (post.type === "media") return true;
  if (post.type === "text") {
    return Boolean(post.body && (post.body.length > 200 || editorialSummaryFromMarkdown(post.body).structured));
  }
  if (post.type === "model_link") return Boolean(post.body && post.body.trim());
  if (post.type === "gitverse") return Boolean((post.gitverse?.description && post.gitverse.description.length > 0) || (post.body && post.body.trim()));
  return false;
}

// Содержимое раскрытого блока — по типу тела, не один универсальный рендер (feed.md §2.4 таблица).
function ExpandedContent({ post }: { post: FeedPost }) {
  if (post.type === "text") {
    return post.body ? <FeedRichBody source={post.body} /> : null;
  }
  if (post.type === "model_link") {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <LetterboxImage
          className="feedPostCardModelPreviewLg"
          src={post.model?.thumb_url}
          onClick={(event) => {
            event.stopPropagation();
            if (post.model_id) navigate(modelPath(post.model_id));
          }}
        />
        {post.body ? <FeedRichBody source={post.body} /> : null}
      </div>
    );
  }
  if (post.type === "media") {
    if (!post.media_url) return null;
    // MF-2035: media_kind раньше игнорировался — любой фото-пост рендерился как <video controls>
    // (чёрный кадр, не проигрывался). image → LetterboxImage (тот же компонент, что model_link
    // превью выше), video → как было.
    return post.media_kind === "image" ? (
      <LetterboxImage className="feedPostImage" src={apiAssetUrl(post.media_url)} onClick={(event) => event.stopPropagation()} />
    ) : (
      <video
        className="feedPostVideo"
        src={apiAssetUrl(post.media_url)}
        poster={post.poster_url ? apiAssetUrl(post.poster_url) : undefined}
        controls
        onClick={(event) => event.stopPropagation()}
      />
    );
  }
  if (post.type === "gitverse") {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {post.gitverse?.description ? <div style={{ color: "var(--text-dim)", fontSize: 14 }}>{post.gitverse.description}</div> : null}
        {post.body ? <FeedRichBody source={post.body} /> : null}
      </div>
    );
  }
  return null;
}

// Композит «Раскрыть»/«Свернуть» (feed.md §2.4/§6.3 `ExpandableCardBody`) — не роут/оверлей,
// плоское визуальное состояние карточки. Регион контента растёт на месте между телом и футером,
// pill остаётся в общем ряду футер-пилюль — оба куска делят состояние через этот хук.
function useExpandableCard() {
  const [expanded, setExpanded] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);
  const [maxHeight, setMaxHeight] = useState(0);

  useEffect(() => {
    if (!contentRef.current) return;
    setMaxHeight(expanded ? contentRef.current.scrollHeight : 0);
  }, [expanded]);

  return { expanded, setExpanded, contentRef, maxHeight };
}

function ExpandRegion({
  post,
  expanded,
  contentRef,
  maxHeight,
}: {
  post: FeedPost;
  expanded: boolean;
  contentRef: RefObject<HTMLDivElement | null>;
  maxHeight: number;
}) {
  return (
    <div className="feedPostCardExpand" style={{ maxHeight: expanded ? maxHeight : 0, opacity: expanded ? 1 : 0 }} aria-hidden={!expanded}>
      <div ref={contentRef} onClick={(event) => event.stopPropagation()}>
        {expanded ? (
          <>
            <ExpandedContent post={post} />
            <button
              type="button"
              className="feedPostCardExpandLink pressable"
              onClick={(event) => {
                event.stopPropagation();
                navigate(feedPostPath(post.id));
              }}
            >
              Перейти к посту →
            </button>
          </>
        ) : null}
      </div>
    </div>
  );
}

function ExpandPill({ expanded, onToggle, onPress }: { expanded: boolean; onToggle: () => void; onPress: () => void }) {
  return (
    <button
      type="button"
      className="feedPill pressable"
      aria-expanded={expanded}
      onPointerDown={onPress}
      onClick={(event) => {
        event.stopPropagation();
        onToggle();
      }}
    >
      <ChevronIcon expanded={expanded} />
      {expanded ? "Свернуть" : "Раскрыть"}
    </button>
  );
}

export function FeedPostCard({
  user,
  post,
  read,
  onVoted,
  onOpen,
  originLabel,
}: {
  user: SessionUser | null;
  post: FeedPost;
  read?: boolean;
  onVoted?: VoteArrowsProps["onVoted"];
  onOpen?: () => void;
  // Приглушённая метка поверх обычной шапки карточки (feed.md §4 «Мои подписки пуст») — карточка
  // из фолбэка общей ленты помечена «Из общей ленты», сама карточка остаётся той же разметки.
  originLabel?: string;
}) {
  const url = new URL(`/feed/p/${post.id}`, window.location.origin).toString();
  const expandable = hasExpandableContent(post);
  const sound = useInteractionSound();
  const { expanded, setExpanded, contentRef, maxHeight } = useExpandableCard();

  return (
    <div
      className="uiCard feedPostCard"
      data-post-type={post.type}
      data-official={isOfficialCommunity(post) || undefined}
      role="link"
      tabIndex={0}
      onClick={() => onOpen?.()}
      onKeyDown={(event) => {
        if (event.target === event.currentTarget && (event.key === "Enter" || event.key === " ")) {
          event.preventDefault();
          onOpen?.();
        }
      }}
    >
      <div className="uiCardGrain" aria-hidden="true" />
      <div className="feedPostCardMeta">
        {originLabel ? <Eyebrow>{originLabel}</Eyebrow> : null}
        <div className="feedPostCardHeader">
          <FeedPostIdentityMark post={post} />
          <div className="feedPostCardIdentity">
            <div className="feedPostCardIdentityTop">
              {post.author ? (
                <button
                  type="button"
                  className="feedPostCardHeaderLink"
                  onClick={(event) => {
                    event.stopPropagation();
                    navigate(profilePath(post.author!.username));
                  }}
                >
                  @{post.author.username}
                </button>
              ) : (
                <span>[удалённый пользователь]</span>
              )}
              <CoAuthorBadge agent={post.co_author} />
            </div>
            <div className="feedPostCardIdentityMeta">
              <span className="feedPostKind">{postKindLabel(post)}</span>
              {post.community ? (
                <>
                  <button
                    type="button"
                    className="feedPostCardHeaderLink"
                    onClick={(event) => {
                      event.stopPropagation();
                      // 2026-07-21: "Открыть сообщество" всегда ведёт на саму страницу саба
                      // (/community/:slug) — не на отфильтрованную ленту. Страница саба теперь сама
                      // показывает посты официальных сабов (вкладка "Новости", communityscreen.tsx),
                      // не только треды — редиректить мимо нет смысла (и не нужно).
                      navigate(communityPath(post.community!.slug));
                    }}
                  >
                    {post.community.name}
                  </button>
                  {isOfficialCommunity(post) ? (
                    <span className="feedOfficialBadge" title="Каталожный канал производителя или модели принтера">✓</span>
                  ) : null}
                </>
              ) : null}
              <span>· {relativeDate(post.created_at)}</span>
              {resolveFeedPostProvenance(post)?.automated ? (
                <span className="feedAgentBadge">Агентская публикация</span>
              ) : null}
            </div>
          </div>
        </div>

        <div className="feedPostCardTitle" data-read={read || undefined}>
          {post.title}
        </div>

        <FeedCardBody post={post} />

        <FeedProvenance post={post} />

        {expandable ? <ExpandRegion post={post} expanded={expanded} contentRef={contentRef} maxHeight={maxHeight} /> : null}

        <div className="feedPostCardFooter">
          <div className="feedPostCardVote" onClick={(event) => event.stopPropagation()}>
            <VoteArrows
              user={user}
              subjectType="feed_post"
              subjectId={post.id}
              votesUp={post.votes_up}
              votesDown={post.votes_down}
              myVote={post.my_vote ?? 0}
              approx={isScoreApprox(post)}
              onVoted={onVoted}
            />
          </div>
          <CardFooterActions
            actions={[
              {
                key: "comments",
                icon: <ChatIcon />,
                label: post.comments_count,
                onClick: () => {
                  sessionStorage.setItem(FEED_ORIGIN_KEY, "1");
                  navigate(`${feedPostPath(post.id)}#comments`);
                },
              },
              {
                key: "share",
                icon: <ShareIcon />,
                label: "Поделиться",
                onClick: () => void share(url, post.title),
              },
            ]}
          />
          {expandable ? <ExpandPill expanded={expanded} onToggle={() => setExpanded((prev) => !prev)} onPress={sound.tick} /> : null}
        </div>
      </div>
    </div>
  );
}

// Скелет карточки — первая загрузка ленты (feed.md §4 «Первая загрузка»): та же геометрия, что
// реальная FeedPostCard (голосовалка-капсула/шапка/тело/футер-пилюли), лента не «прыгает» при
// подстановке реальных данных, только пилюли-плейсхолдеры мерцают shimmer'ом.
export function FeedPostCardSkeleton() {
  return (
    <div className="uiCard feedPostCard feedPostCardSkeleton" aria-hidden="true">
      <div className="feedSkeletonVote" />
      <div className="feedPostCardMeta">
        <div className="feedSkeletonLine" style={{ width: "40%", height: 12 }} />
        <div className="feedSkeletonLine" style={{ width: "70%", height: 18 }} />
        <div className="feedSkeletonLine" style={{ width: "95%" }} />
        <div className="feedSkeletonLine" style={{ width: "80%" }} />
        <div className="feedPostCardFooter">
          <div className="feedSkeletonPill" />
          <div className="feedSkeletonPill" />
        </div>
      </div>
    </div>
  );
}
