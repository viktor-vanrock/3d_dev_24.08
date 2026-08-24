import { useEffect, useRef, useState } from "react";
// eslint-disable-next-line boundaries/element-types -- легатное междоменное ребро (микроэтап 7.6): рантайм-зависимость, не тип/utility; развязка отложена до pages/DI-этапа. См. apps/web/MIGRATION.md.
import { useGuestLogin } from "@domains/access";
// eslint-disable-next-line boundaries/element-types -- легатное междоменное ребро (Этап 9): social→ai ASSISTANT_CONTEXT_SEARCH_EVENT (лента слушает контекстный поиск ассистента), развязка отложена до pages/DI. См. MIGRATION.md.
import { ASSISTANT_CONTEXT_SEARCH_EVENT, type AssistantContextSearchDetail } from "@domains/ai";
import type { SessionUser } from "@shared/types";
import {
  communityMemberCountValue,
  formatMemberCount,
  getCommunity,
  listCommunities,
  subscribeCommunity,
  unsubscribeCommunity,
  type Community,
} from "../community/api.ts";
import { communityDisplayName } from "../community/displayname.ts";
import { communityFaviconUrl } from "../community/favicon.ts";
import { AvatarBubble, DEFAULT_AVATAR, deterministicAvatarConfig } from "@shared/avatar";
// eslint-disable-next-line boundaries/element-types, boundaries/entry-point -- легатное ребро (Этап 4.5): CSS side-effect, не index.ts; home.css остаётся общим "рабочим хромом" для доменных экранов, развязка отложена до pages/DI (Этап 10). См. MIGRATION.md.
import "@pages/home/home.css";
import { HomeHeader, type Section, useSectionSwipeNav } from "@platform/nav";
import { useOverlay } from "@platform/overlay";
import {
  communityPath,
  communitiesPath,
  type FeedListScope,
  feedNewPath,
  feedPath,
  feedPostPath,
  headerModeFor,
  navigate,
} from "../../../router.ts";
import { AuroraBackground, SegmentToggle, Button, Card, Chip, EmptyState, Eyebrow, IconButton } from "@shared/ui";
import {
  listCommunityFeed,
  listFeed,
  listMyCommunities,
  type FeedCommunityOption,
  type FeedPost,
} from "./api.ts";
import { trackFeedEvent } from "./events.ts";
import "./feed.css";
import { FEED_ORIGIN_KEY } from "./post.tsx";
import { FeedPostCard, FeedPostCardSkeleton } from "./postcard.tsx";

const PAGE_SIZE = 24;
// Тач-fallback переключается после 3 автодогрузок подряд (feed.md §4, тот же паттерн, что
// ideas.md §1.5): дальше сентинел больше не триггерит, только явный тап по кнопке.
const AUTO_LOAD_LIMIT = 3;

// Правая колонка уезжает в поток центральной колонки после 5-го поста <1400px (feed.md §5).
const RIGHT_RAIL_INLINE_AFTER = 5;
const FEED_READ_POSTS_KEY = "portal.feed.readPosts";
// В discovery-рельсе четыре живых обсуждения: персонажи остаются читаемыми и не превращают
// блок в второй бесконечный фид.
const HOT_LIST_SIZE = 4;
// «Горячие сообщества» — 5 строк по числу подписчиков, из батча побольше, раз
// сортировки по member_count на бэке нет (см. communityMemberCountValue, community/api.ts).
const HOT_COMMUNITY_LIST_SIZE = 5;
const HOT_COMMUNITY_FETCH_BATCH = 24;
const FEED_SCOPE_OPTIONS = [
  { value: "all", label: "Лента" },
  { value: "subscribed", label: "Подписки" },
] satisfies { value: FeedListScope; label: string }[];

function feedUsesSingleColumnNow(): boolean {
  return typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(max-width: 899px)").matches;
}

function useFeedSingleColumn(): boolean {
  const [singleColumn, setSingleColumn] = useState(feedUsesSingleColumnNow);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const media = window.matchMedia("(max-width: 899px)");
    const update = () => setSingleColumn(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  return singleColumn;
}

function initialReadPostIds(): Set<string> {
  try {
    const stored = JSON.parse(sessionStorage.getItem(FEED_READ_POSTS_KEY) ?? "[]") as unknown;
    return new Set(Array.isArray(stored) ? stored.filter((id): id is string => typeof id === "string") : []);
  } catch {
    return new Set();
  }
}

// Реальная иконка бренда вместо цветной буквы (MF-2039, живая проверка оператором «Мои сабы»):
// приоритет cover_image_url (загруженная обложка custom-саба) → favicon домена вендора (тот же
// keyless Google-приём, что уже применён к карточкам источников в постах, feed/richbody.tsx) →
// буква как последний фолбэк. onError переключает на букву, если favicon не подгрузился (404 у
// самого Google-сервиса на неизвестный домен, сетевой сбой и т.п.) — круг ВСЕГДА что-то показывает,
// никогда не остаётся пустым/сломанным img. Общий и для "Мои сабы", и для "Горячие сообщества".
function CommunityMark({
  className,
  kind,
  name,
  website,
  coverImageUrl,
}: {
  className: string;
  kind?: string;
  name: string;
  website?: string | null;
  coverImageUrl?: string | null;
}) {
  const [imgFailed, setImgFailed] = useState(false);
  const src = coverImageUrl || (website ? communityFaviconUrl(website) : null);
  return (
    <span className={className} data-kind={kind ?? "custom"} aria-hidden="true">
      {src && !imgFailed ? (
        <img src={src} alt="" loading="lazy" decoding="async" onError={() => setImgFailed(true)} />
      ) : (
        communityDisplayName(name).slice(0, 1).toUpperCase()
      )}
    </span>
  );
}

// «Мои сабы» — тот же контент, что п.3 §1.2, переиспользуется и в левой sticky-колонке (≥900px),
// и в mobile sheet() (<900px, feed.md §5) — один источник разметки, два места вывода.
function MySubsList({
  items,
  activeSlug,
  onDiscover,
}: {
  items: FeedCommunityOption[] | null;
  activeSlug?: string;
  onDiscover: () => void;
}) {
  return (
    <div className="feedSideSection">
      <Eyebrow>Мои сабы</Eyebrow>
      {items === null ? (
        <div className="feedSubsSkeleton" aria-label="Загрузка подписок">
          <span />
          <span />
          <span />
        </div>
      ) : items.length === 0 ? (
        <div className="feedSideEmpty">
          Подпишитесь на бренд или свой принтер — важное соберётся здесь.
        </div>
      ) : (
        <nav className="feedSubsList" aria-label="Мои сабы">
          {items.map((item) => {
            const official = item.is_official || item.kind === "vendor" || item.kind === "machine";
            return (
              <button
                type="button"
                key={item.id}
                className="feedSubRow pressable"
                data-active={item.slug === activeSlug || undefined}
                onClick={() => navigate(communityPath(item.slug))}
              >
                <CommunityMark className="feedSubMark" kind={item.kind} name={item.name} website={item.website} />
                <span className="feedSubCopy">
                  <span>{communityDisplayName(item.name)}</span>
                  <small>{official ? "Официальный канал" : "Сообщество"}</small>
                </span>
              </button>
            );
          })}
        </nav>
      )}
      <button type="button" className="feedSideFootLink pressable" onClick={onDiscover}>
        Найти сабы →
      </button>
    </div>
  );
}

// Три колонки /feed (MF-959, docs/design/feed.md §1.1). Заменяет прежний одноколоночный мост
// (MF-816) — левая/правая колонки уже реальный каркас (§1.2/§1.3). Правая колонка (MF-971,
// feed.md §1.3): «Сейчас горячо» — GET /feed?sort=hot (доступно гостю, как и основная лента),
// «Горячие сообщества» — GET /communities (401 без сессии — вся community/* зона гостевого read-пути
// не имеет, community/api.ts — поэтому блок честно предлагает гостю войти, не 401-ит молча).
// «Мои сабы» используют тот же `GET /communities?member=me`, что редактор публикации, поэтому
// список и mobile-sheet не расходятся. Карточка поста (§2) и VoteArrows (§3) переиспользуются.
export function FeedScreen({
  user,
  section,
  onSectionChange,
  scope = "all",
  community,
  renderHeader = true,
}: {
  // Гость читает ленту без входа (MF-850/MF-912, feed.md §3/§4) — голосовалка карточки
  // (FeedPostCard → VoteArrows) сама уходит в overlay-промпт входа на тапе, если user null.
  user: SessionUser | null;
  section: Section;
  onSectionChange: (section: Section) => void;
  scope?: FeedListScope;
  community?: string;
  renderHeader?: boolean;
}) {
  const singleColumn = useFeedSingleColumn();
  const [items, setItems] = useState<FeedPost[] | null | undefined>(undefined);
  const [loadError, setLoadError] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState(false);
  const [autoLoadCount, setAutoLoadCount] = useState(0);
  const [communityDetails, setCommunityDetails] = useState<Community | null | undefined>(undefined);
  const [leaveBusy, setLeaveBusy] = useState(false);
  const [requestAccessBusy, setRequestAccessBusy] = useState(false);
  const [readPostIds, setReadPostIds] = useState(initialReadPostIds);
  // Первый вход без подписок (feed.md §4): счётчик «моих сабов» решает, показывать ли баннер
  // с предложением подписаться — null, пока неизвестно (гость/скоуп «Мои подписки»/саб-лента).
  const [mySubsCount, setMySubsCount] = useState<number | null>(null);
  const [mySubs, setMySubs] = useState<FeedCommunityOption[] | null>(null);
  const [suggestions, setSuggestions] = useState<Community[]>([]);
  const [subscribedIds, setSubscribedIds] = useState<Set<string>>(new Set());
  const [subscribingId, setSubscribingId] = useState<string | null>(null);
  // Пустые «Мои подписки» (feed.md §4): фолбэк — первые 5 постов общей ленты, отдельная загрузка
  // от основной пагинации (не смешивается с cursor'ом ленты подписок).
  const [subsFallback, setSubsFallback] = useState<FeedPost[] | null>(null);
  // «Сейчас горячо» правой колонки (feed.md §1.3 п.1, MF-971) — undefined = загрузка, null = ошибка,
  // fetchedAt — честная метка «обновлено N мин назад» вместо иллюзии реалтайма (эпик §2).
  const [hotPosts, setHotPosts] = useState<FeedPost[] | null | undefined>(undefined);
  const [hotFetchedAt, setHotFetchedAt] = useState<number | null>(null);
  // «Горячие сообщества» — компактный discovery-список, не второй каталог с фильтрами:
  // всегда верхние пять по аудитории из одного батча.
  const [catalogItems, setCatalogItems] = useState<Community[] | null | undefined>(undefined);
  const [catalogBusyId, setCatalogBusyId] = useState<string | null>(null);
  const [feedQuery, setFeedQuery] = useState("");
  const promptGuestLogin = useGuestLogin();
  const sentinelRef = useRef<HTMLDivElement>(null);
  const cursorRef = useRef<string | null>(null);
  const loadingMoreRef = useRef(false);
  cursorRef.current = nextCursor;
  loadingMoreRef.current = loadingMore;
  const overlay = useOverlay();
  const swipe = useSectionSwipeNav(section, onSectionChange);

  const apiScope = scope === "subscribed" ? "subscribed" : "all";
  const isClosedCommunity = !!communityDetails && communityDetails.visibility === "unlisted" && communityDetails.viewer_role === null;

  useEffect(() => {
    const onContextSearch = (event: Event) => {
      const detail = (event as CustomEvent<AssistantContextSearchDetail>).detail;
      if (detail?.context.kind === "feed") setFeedQuery(detail.query.trim());
    };
    window.addEventListener(ASSISTANT_CONTEXT_SEARCH_EVENT, onContextSearch);
    return () => window.removeEventListener(ASSISTANT_CONTEXT_SEARCH_EVENT, onContextSearch);
  }, []);

  async function loadFirstPage(): Promise<void> {
    setItems(undefined);
    setLoadError(false);
    setNextCursor(null);
    setLoadMoreError(false);
    setAutoLoadCount(0);
    let page;
    if (community) {
      const target = await getCommunity(community);
      setCommunityDetails(target);
      if (!target) {
        setLoadError(true);
        setItems(null);
        return;
      }
      // Закрытый саб (feed.md §4 «Закрытый саб») — я не участник unlisted-сообщества: ленту не
      // грузим вовсе, экран сразу показывает access-gate (isClosedCommunity в рендере).
      if (target.visibility === "unlisted" && target.viewer_role === null) {
        setItems(null);
        return;
      }
      page = await listCommunityFeed(target.id, { limit: PAGE_SIZE });
    } else {
      setCommunityDetails(undefined);
      page = await listFeed({ limit: PAGE_SIZE, scope: apiScope });
    }
    if (!page) {
      setLoadError(true);
      setItems(null);
      return;
    }
    setItems(page.items);
    setNextCursor(page.next_cursor);
  }

  useEffect(() => {
    void loadFirstPage();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiScope, community]);

  // Первый вход без подписок (feed.md §4): считаем «мои сабы» только на скоупе «Всё» общей ленты —
  // подписка требует сессии, гость её никогда не имеет (member=me 401-ит без сессии → пустой []).
  useEffect(() => {
    if (!user) {
      setMySubsCount(null);
      setMySubs([]);
      return;
    }
    let cancelled = false;
    void listMyCommunities().then((mine) => {
      if (!cancelled) {
        setMySubs(mine);
        setMySubsCount(community || apiScope !== "all" ? null : mine.length);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [user, community, apiScope]);

  // Предложенные саба баннера — по каталогу (listMyCommunities/printer_connections матчинг под
  // конкретный принтер зрителя ещё не имеет ручки на бэке, GAP-API), только когда подписок нет.
  useEffect(() => {
    if (mySubsCount !== 0) {
      setSuggestions([]);
      return;
    }
    let cancelled = false;
    void listCommunities({ limit: 3 }).then((result) => {
      if (!cancelled) setSuggestions(result?.items ?? []);
    });
    return () => {
      cancelled = true;
    };
  }, [mySubsCount]);

  // Пустые «Мои подписки» (feed.md §4): фолбэк на первые 5 постов общей ленты, только когда
  // основная лента подписок подтверждённо пуста (не во время загрузки/ошибки).
  useEffect(() => {
    if (community || apiScope !== "subscribed" || items === undefined || items === null || items.length > 0) {
      setSubsFallback(null);
      return;
    }
    let cancelled = false;
    void listFeed({ limit: 5, scope: "all" }).then((result) => {
      if (!cancelled) setSubsFallback(result?.items ?? []);
    });
    return () => {
      cancelled = true;
    };
  }, [community, apiScope, items]);

  async function loadMore(auto: boolean) {
    if (!cursorRef.current || loadingMoreRef.current) return;
    if (auto && autoLoadCount >= AUTO_LOAD_LIMIT) return;
    setLoadingMore(true);
    setLoadMoreError(false);
    const page = community
      ? communityDetails
        ? await listCommunityFeed(communityDetails.id, { limit: PAGE_SIZE, cursor: cursorRef.current })
        : null
      : await listFeed({ limit: PAGE_SIZE, scope: apiScope, cursor: cursorRef.current });
    setLoadingMore(false);
    if (!page) {
      setLoadMoreError(true);
      return;
    }
    setItems((prev) => [...(prev ?? []), ...page.items]);
    setNextCursor(page.next_cursor);
    if (auto) setAutoLoadCount((count) => count + 1);
  }

  // Инфинит-скролл (feed.md §4 «Догрузка»): сентинел у низа ленты, после 3 автодогрузок подряд
  // сентинел перестаёт триггерить — остаётся только тач-fallback «Показать ещё» ниже.
  useEffect(() => {
    const node = sentinelRef.current;
    if (!node || !nextCursor || autoLoadCount >= AUTO_LOAD_LIMIT) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) void loadMore(true);
    });
    observer.observe(node);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nextCursor, autoLoadCount]);

  // «Сейчас горячо» (feed.md §1.3 п.1, MF-971) — витрина-список независимая от текущего скоупа/
  // саба («что ещё» — открытие нового, не текущая лента), один раз на вход в экран, доступна
  // гостю (GET /feed без scope=subscribed не требует сессии, apps/api/src/feed/routes.ts).
  useEffect(() => {
    let cancelled = false;
    void listFeed({ sort: "hot", limit: HOT_LIST_SIZE }).then((page) => {
      if (cancelled) return;
      if (!page) {
        setHotPosts(null);
        return;
      }
      setHotPosts(page.items);
      setHotFetchedAt(Date.now());
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // «Горячие сообщества» — календарь релизов живёт в /printers, а лента помогает открыть
  // активные места общения. GET /communities пока требует сессию, поэтому гостю показываем
  // честный CTA входа и не спамим 401.
  useEffect(() => {
    if (!user) {
      setCatalogItems(undefined);
      return;
    }
    let cancelled = false;
    setCatalogItems(undefined);
    void listCommunities({ limit: HOT_COMMUNITY_FETCH_BATCH }).then((result) => {
      if (cancelled) return;
      if (!result) {
        setCatalogItems(null);
        return;
      }
      const bySubscribers = [...result.items].sort(
        (a, b) =>
          communityMemberCountValue(b.member_count) - communityMemberCountValue(a.member_count) ||
          (b.thread_count ?? 0) - (a.thread_count ?? 0),
      );
      setCatalogItems(bySubscribers.slice(0, HOT_COMMUNITY_LIST_SIZE));
    });
    return () => {
      cancelled = true;
    };
  }, [user]);

  function openPost(id: string) {
    setReadPostIds((current) => {
      const next = new Set(current).add(id);
      sessionStorage.setItem(FEED_READ_POSTS_KEY, JSON.stringify([...next]));
      return next;
    });
    sessionStorage.setItem(FEED_ORIGIN_KEY, "1");
    navigate(feedPostPath(id));
  }

  // Гость → overlay-промпт входа вместо LoginPage (feed.md §4, feed.post.editor.md §5):
  // после входа гость остаётся на /feed и жмёт «Написать пост» ещё раз, чистая навигация,
  // не запрос с данными — доигрывать через guestintent.ts не нужно.
  function onWritePost() {
    if (!user) {
      promptGuestLogin();
      return;
    }
    navigate(feedNewPath());
  }

  function setScope(next: FeedListScope) {
    if (!community && next === scope) return;
    // feed_scope_change (feed.md §1.2 п.2, MF-823/MF-980) — только явное переключение сегмента
    // «Всё»/«Мои подписки» пользователем, не смена скоупа при заходе по прямой ссылке/навигации.
    trackFeedEvent("feed_scope_change", { scope: next });
    navigate(feedPath(next));
  }

  async function unsubscribe() {
    if (!communityDetails || leaveBusy) return;
    setLeaveBusy(true);
    // Отписка из шапки ленты вызывает /subscribe (не историческую /leave, MF-415) — только эта
    // ручка эмитит community_subscribe (membership.ts), иначе отписка из ленты теряется молча
    // для воронки MF-808. source='feed_left' — контрол зеркалит «где я» левой колонки (feed.md §1.2).
    const result = await unsubscribeCommunity(communityDetails.id, "feed_left");
    setLeaveBusy(false);
    if (result !== true) {
      overlay.toast({ severity: "warn", title: "Не удалось отписаться" });
      return;
    }
    navigate(feedPath());
  }

  // Чип «Подписаться» баннера первого входа (feed.md §4) — гость получает overlay-промпт входа,
  // как и остальные действия, требующие сессии, вместо тихого 401. source='feed_right' — баннер
  // играет ту же роль открытия нового, что «Что ещё» правой колонки (feed.md §1.3).
  async function subscribeSuggested(id: string) {
    if (!user) {
      promptGuestLogin();
      return;
    }
    if (subscribingId) return;
    setSubscribingId(id);
    const result = await subscribeCommunity(id, "feed_right");
    setSubscribingId(null);
    if (result !== true) {
      overlay.toast({ severity: "warn", title: "Не удалось подписаться" });
      return;
    }
    setSubscribedIds((current) => new Set(current).add(id));
  }

  // «Запросить доступ» закрытого саба (feed.md §4) — subscribe остаётся единственной ручкой
  // членства на бэке (нет отдельной approve-очереди), успешный вызов сразу открывает ленту саба.
  // source='feed_left' зеркалит «Отписаться» той же шапки (см. unsubscribe() выше).
  async function requestCommunityAccess() {
    if (!communityDetails || requestAccessBusy) return;
    setRequestAccessBusy(true);
    const result = await subscribeCommunity(communityDetails.id, "feed_left");
    setRequestAccessBusy(false);
    if (result !== true) {
      overlay.toast({ severity: "warn", title: "Не удалось запросить доступ" });
      return;
    }
    void loadFirstPage();
  }

  // Чип «Подписаться»/«Отписаться» каталога фидов (feed.md §1.3 п.3) — «подписка отсюда не
  // уводит со страницы», тот же оптимистичный паттерн, что вступление в сообщество
  // (community.md §2.2): правим локальный список сразу, откатываем на ошибке. source='feed_right'
  // зеркалит баннер первого входа выше — оба открывают новое из правой колонки.
  async function toggleCatalogSubscription(item: Community) {
    if (!user) {
      promptGuestLogin();
      return;
    }
    if (catalogBusyId) return;
    const wasSubscribed = item.viewer_role !== null;
    setCatalogBusyId(item.id);
    const result = wasSubscribed ? await unsubscribeCommunity(item.id, "feed_right") : await subscribeCommunity(item.id, "feed_right");
    setCatalogBusyId(null);
    if (result !== true) {
      overlay.toast({ severity: "warn", title: wasSubscribed ? "Не удалось отписаться" : "Не удалось подписаться" });
      return;
    }
    setCatalogItems((current) =>
      current ? current.map((entry) => (entry.id === item.id ? { ...entry, viewer_role: wasSubscribed ? null : "member" } : entry)) : current,
    );
  }

  // <900px левая колонка сворачивается в липкую полосу + «Фиды» открывает sheet() с тем же
  // содержимым п.3 §1.2 (feed.md §5) — тот же паттерн, что мобильный шит фильтров каталога.
  function openSubsSheet() {
    overlay.sheet({
      title: "Мои сабы",
      content: <MySubsList items={mySubs} activeSlug={community} onDiscover={() => navigate(communitiesPath())} />,
    });
  }

  const rightRailSections = (
    <>
      <FeedHotSection posts={hotPosts} fetchedAt={hotFetchedAt} onOpen={openPost} />
      <FeedHotCommunities
        user={user}
        items={catalogItems}
        busyId={catalogBusyId}
        onToggle={(item) => void toggleCatalogSubscription(item)}
        onGuestPrompt={promptGuestLogin}
      />
    </>
  );

  const normalizedFeedQuery = feedQuery.toLocaleLowerCase("ru");
  const displayedItems = (items ?? []).filter((post) => {
    if (!normalizedFeedQuery) return true;
    return [post.title, post.body, post.author?.username, post.community?.name]
      .filter(Boolean)
      .some((value) => String(value).toLocaleLowerCase("ru").includes(normalizedFeedQuery));
  });
  const firstItems = displayedItems.slice(0, RIGHT_RAIL_INLINE_AFTER);
  const restItems = displayedItems.slice(RIGHT_RAIL_INLINE_AFTER);
  const unreadCount = displayedItems.reduce((count, post) => count + (readPostIds.has(post.id) ? 0 : 1), 0);

  return (
    <div className="home">
      <AuroraBackground />
      {renderHeader ? (
        <div style={{ position: "relative", zIndex: 30 }}>
          <HomeHeader user={user} printers={[]} section={section} onSectionChange={onSectionChange} mode={headerModeFor("feed")} />
        </div>
      ) : null}

      <main
        className="feedWideBody homeWorkspaceBody"
        style={swipe.dragX !== 0 ? { transform: `translateX(${swipe.dragX}px)` } : undefined}
        onPointerDown={swipe.onPointerDown}
        onPointerMove={swipe.onPointerMove}
        onPointerUp={swipe.onPointerUp}
        onPointerCancel={swipe.onPointerCancel}
      >
        <div className="feedLayout">
          <aside className="feedSideLeft">
            {!community && !singleColumn ? (
              <SegmentToggle
                options={FEED_SCOPE_OPTIONS}
                value={scope}
                onChange={setScope}
                ariaLabel="Фильтр ленты"
                className="feedScopeTabs feedScopeTabsDesktop"
              />
            ) : null}
            <Card className="feedSideCard feedCreateCard">
              <div className="feedCreateIntro">
                <AvatarBubble config={{ ...DEFAULT_AVATAR, pose: "wave", accessory: "wrench" }} size={54} facing="right" />
                <div>
                  <strong>Покажите, что сделали</strong>
                  <span>Фото, проект, модель или репозиторий.</span>
                </div>
              </div>
              <Button variant="primary" onClick={onWritePost}>
                Написать пост
              </Button>
            </Card>
            <Card className="feedSideCard">
              <MySubsList items={mySubs} activeSlug={community} onDiscover={() => navigate(communitiesPath())} />
            </Card>
          </aside>

          <div className="feedCenter">
            {feedQuery ? (
              <div className="feedContextSearchStatus" role="status">
                <span>По загруженной ленте: «{feedQuery}» · {displayedItems.length}</span>
                <button type="button" className="pressable" onClick={() => setFeedQuery("")}>Сбросить</button>
              </div>
            ) : null}
            {communityDetails ? (
              <div className="feedHeaderRow">
                <div className="feedPageHeading">
                  <Eyebrow>Сообщество</Eyebrow>
                  <h1># {communityDisplayName(communityDetails.name)}</h1>
                  <p>{communityDetails.description || "Обсуждения, модификации и находки этого сообщества."}</p>
                </div>
                <div className="feedHeaderActions">
                  {isClosedCommunity ? null : (
                    <Button variant="secondary" loading={leaveBusy} onClick={() => void unsubscribe()}>
                      Отписаться
                    </Button>
                  )}
                </div>
              </div>
            ) : singleColumn ? (
              <div className="feedMobileScope">
                <SegmentToggle
                  options={FEED_SCOPE_OPTIONS}
                  value={scope}
                  onChange={setScope}
                  ariaLabel="Фильтр ленты"
                  className="feedScopeTabs"
                />
                <span className="feedSubsTrigger">
                  <IconButton label="Фиды" wide onClick={openSubsSheet}>
                    <span aria-hidden="true" style={{ fontFamily: "var(--font-display)", fontSize: 14, fontWeight: 500 }}>
                      Фиды
                    </span>
                  </IconButton>
                </span>
              </div>
            ) : null}
            {items === undefined ? (
              // Первая загрузка (feed.md §4): 4-5 карточек-скелетов той же геометрии, что
              // реальная карточка — лента не «прыгает» при подстановке реальных данных.
              <>
                {Array.from({ length: 5 }).map((_, index) => (
                  <FeedPostCardSkeleton key={index} />
                ))}
              </>
            ) : loadError ? (
              <div className="feedLoadError">
                Не удалось загрузить ленту ·{" "}
                <button type="button" className="feedRetryInline pressable" onClick={() => void loadFirstPage()}>
                  Повторить
                </button>
              </div>
            ) : isClosedCommunity ? (
              // Закрытый саб (feed.md §4): вместо ленты — центрированный access-gate, не 404 и
              // не пустая лента.
              <EmptyState
                icon={<LockIcon />}
                title="Это закрытое сообщество"
                sub="Публикации видят только участники — запросите доступ, чтобы читать и участвовать."
                action={
                  <Button variant="secondary" loading={requestAccessBusy} onClick={() => void requestCommunityAccess()}>
                    Запросить доступ
                  </Button>
                }
              />
            ) : (
              <>
                {suggestions.length > 0 ? (
                  <FeedSuggestBanner
                    suggestions={suggestions}
                    subscribedIds={subscribedIds}
                    subscribingId={subscribingId}
                    onSubscribe={(id) => void subscribeSuggested(id)}
                  />
                ) : null}
                {displayedItems.length === 0 ? (
                  feedQuery ? (
                    <EmptyState
                      icon={<SearchIcon />}
                      title="В загруженной ленте ничего нет"
                      sub="Сбросьте запрос или продолжите в ГигаЧате — полный поиск по постам подключает бэкенд-команда."
                      action={<Button variant="secondary" onClick={() => setFeedQuery("")}>Сбросить поиск</Button>}
                    />
                  ) :
                  apiScope === "subscribed" && !community ? (
                    <FeedSubscribedEmptyFallback user={user} posts={subsFallback} readPostIds={readPostIds} onOpen={openPost} />
                  ) : (
                    <EmptyState
                      icon={
                        <AvatarBubble
                          config={{ ...DEFAULT_AVATAR, pose: "think", accessory: "spatula" }}
                          size={88}
                          facing="right"
                        />
                      }
                      title="Здесь пока тихо"
                      sub="Станьте первым: покажите сборку, задайте вопрос или принесите проект."
                      action={
                        <Button variant="secondary" onClick={onWritePost}>
                          Написать пост
                        </Button>
                      }
                    />
                  )
                ) : (
                  <>
                    {firstItems.map((post) => (
                      <FeedPostCard key={post.id} user={user} post={post} read={readPostIds.has(post.id)} onOpen={() => openPost(post.id)} />
                    ))}
                    {/* <1280px правая колонка уезжает из sidebar сюда, в поток центральной колонки,
                        после 5-го поста — те же три подблока (feed.md §5). */}
                    <Card className="feedSideCard feedRailStack feedRightRailInline">{rightRailSections}</Card>
                    {restItems.map((post) => (
                      <FeedPostCard key={post.id} user={user} post={post} read={readPostIds.has(post.id)} onOpen={() => openPost(post.id)} />
                    ))}

                    {loadMoreError ? (
                      <div className="feedLoadError">
                        Не удалось загрузить · {" "}
                        <button type="button" className="feedRetryInline pressable" onClick={() => void loadMore(false)}>
                          Повторить
                        </button>
                      </div>
                    ) : null}

                    <div ref={sentinelRef} aria-hidden="true" />

                    {nextCursor ? (
                      loadingMore ? (
                        <div className="feedLoadMoreSpinner" role="status" aria-label="Загрузка">
                          <span className="uiButtonSpinner" aria-hidden="true" />
                        </div>
                      ) : autoLoadCount >= AUTO_LOAD_LIMIT ? (
                        <button type="button" className="feedShowMore pressable" onClick={() => void loadMore(false)}>
                          Показать ещё
                        </button>
                      ) : null
                    ) : (
                      <div className="feedEndOfList">
                        <AvatarBubble config={{ ...DEFAULT_AVATAR, pose: "cheer" }} size={52} facing="left" />
                        <span>
                          <strong>{unreadCount === 0 ? "Вы всё прочитали" : `Осталось непрочитанных: ${unreadCount}`}</strong>
                          <small>Новые работы и обновления появятся здесь.</small>
                        </span>
                      </div>
                    )}
                  </>
                )}
              </>
            )}
          </div>

          <aside className="feedSideRight">
            <Card className="feedSideCard feedRailStack">{rightRailSections}</Card>
          </aside>
        </div>
      </main>

      {/* ≤640px bottom-tab-режим (feed.md §5): «Написать пост» уезжает из левой колонки
          (та уже `display:none` ниже 900px, feed.css) в плавающий FAB над таббаром — тот же
          приём, что «Создать сообщество» (.cmtyCreateFab, communitylist.tsx). */}
      <button type="button" className="feedWriteFab pressable" aria-label="Написать пост" onClick={onWritePost}>
        <PlusIcon />
      </button>
    </div>
  );
}

function PlusIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="5" y="11" width="14" height="9" rx="2" stroke="currentColor" strokeWidth="1.6" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

// Баннер первого входа без подписок (feed.md §4 «Первый раз, подписок нет») — мягкая полоса над
// лентой, не блокирует чтение под собой: 3 предложенных саба-чипа, тап переключает на «Подписан».
function FeedSuggestBanner({
  suggestions,
  subscribedIds,
  subscribingId,
  onSubscribe,
}: {
  suggestions: Community[];
  subscribedIds: Set<string>;
  subscribingId: string | null;
  onSubscribe: (id: string) => void;
}) {
  return (
    <Card className="feedSuggestBanner">
      <div className="feedSuggestBannerCopy">Подпишитесь на свой принтер — лента станет вашей</div>
      <div className="feedSuggestChips">
        {suggestions.map((item) => {
          const subscribed = subscribedIds.has(item.id);
          return (
            <Chip key={item.id} selected={subscribed} disabled={subscribed || subscribingId === item.id} onClick={() => onSubscribe(item.id)}>
              {communityDisplayName(item.name)} · {subscribed ? "Подписан" : "Подписаться"}
            </Chip>
          );
        })}
      </div>
    </Card>
  );
}

// Пустые «Мои подписки» (feed.md §4) — плашка-объяснение + первые 5 постов общей ленты, каждый
// с приглушённой меткой «Из общей ленты» поверх обычной шапки карточки (postcard.tsx#originLabel).
function FeedSubscribedEmptyFallback({
  user,
  posts,
  readPostIds,
  onOpen,
}: {
  user: SessionUser | null;
  posts: FeedPost[] | null;
  readPostIds: Set<string>;
  onOpen: (id: string) => void;
}) {
  return (
    <>
      <div className="feedSubsEmptyBanner">
        <div className="feedSubsEmptyTitle">В ваших сабах пока тихо</div>
        <div className="feedSubsEmptySub">Показываем первые посты общей ленты — пока в подписках не появится новое.</div>
      </div>
      {posts === null
        ? Array.from({ length: 5 }).map((_, index) => <FeedPostCardSkeleton key={index} />)
        : posts.map((post) => (
            <FeedPostCard
              key={post.id}
              user={user}
              post={post}
              read={readPostIds.has(post.id)}
              originLabel="Из общей ленты"
              onOpen={() => onOpen(post.id)}
            />
          ))}
    </>
  );
}

// Компакт-счётчик голосов мини-карточки «Сейчас горячо» (feed.md §1.3 п.1) — та же граница
// сжатия в "k", что и остальные компакт-числа приложения (толп нет — цельная тысяча уже редкость
// для V1, но карточка не должна ломать раскладку на всплеске).
function formatFeedScore(score: number): string {
  if (Math.abs(score) >= 1000) return `${(score / 1000).toLocaleString("ru-RU", { maximumFractionDigits: 1 })}k`;
  return score.toLocaleString("ru-RU");
}

// «Обновлено N мин назад» (feed.md §1.3 п.1) — честная метка момента загрузки блока, не имитация
// реалтайма (эпик §2): считаем от fetchedAt, не опрашиваем сервер заново на каждый рендер.
function hotFreshnessLabel(fetchedAt: number): string {
  const minutes = Math.max(0, Math.floor((Date.now() - fetchedAt) / 60000));
  if (minutes < 1) return "обновлено только что";
  return `обновлено ${minutes} мин назад`;
}

// Discovery-обсуждения: вместо безличной нумерации показываем того, кто начал разговор.
// Пользователь всегда представлен 3D-персонажем; аватар сообщества остаётся в его собственной
// строке ниже. Если API ещё не прислал manifest персонажа, детерминированный seed сохраняет
// узнаваемость между рендерами.
function FeedHotSection({
  posts,
  fetchedAt,
  onOpen,
}: {
  posts: FeedPost[] | null | undefined;
  fetchedAt: number | null;
  onOpen: (id: string) => void;
}) {
  return (
    <div className="feedSideSection">
      <div className="feedRailHeading">
        <Eyebrow>Сейчас обсуждают</Eyebrow>
        <span>в мастерской</span>
      </div>
      {posts === undefined ? (
        <FeedRailSkeleton rows={4} />
      ) : posts === null ? (
        <div className="feedSideEmpty">Не удалось загрузить.</div>
      ) : posts.length === 0 ? (
        <div className="feedSideEmpty">Пока без горячих постов.</div>
      ) : (
        <>
          <ul className="feedHotList">
            {posts.map((post, index) => (
              <li key={post.id}>
                <button type="button" className="feedHotItem pressable" onClick={() => onOpen(post.id)}>
                  <span className="feedHotAvatar" aria-hidden="true">
                    <AvatarBubble
                      config={post.author?.avatar_config ?? deterministicAvatarConfig(post.author?.username ?? post.author_id)}
                      snapshots={post.author?.avatar_config ? (post.author.avatar_snapshots ?? null) : null}
                      size={42}
                      facing="front"
                    />
                    <span className="feedHotRank">{index + 1}</span>
                  </span>
                  <span className="feedHotItemCopy">
                    <span className="feedHotItemTitle">{post.title}</span>
                    <span className="feedHotItemMeta">
                      {post.community ? `${post.community.name} · ` : ""}
                      {formatFeedScore(post.votes_up - post.votes_down)} голосов · {post.comments_count} ответов
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {fetchedAt ? <div className="feedHotFreshness">{hotFreshnessLabel(fetchedAt)}</div> : null}
        </>
      )}
    </div>
  );
}

// Горячие сообщества: компактный reddit-подобный рейтинг с собственными community-аватарами.
// Поиск вынесен в полноценный каталог — в правом discovery-рельсе остаётся только быстрый выбор.
function FeedHotCommunities({
  user,
  items,
  busyId,
  onToggle,
  onGuestPrompt,
}: {
  user: SessionUser | null;
  items: Community[] | null | undefined;
  busyId: string | null;
  onToggle: (item: Community) => void;
  onGuestPrompt: () => void;
}) {
  return (
    <div className="feedSideSection">
      <div className="feedRailHeading">
        <Eyebrow>Горячие сообщества</Eyebrow>
        <span>сейчас растут</span>
      </div>
      {!user ? (
        <div className="feedSideEmpty">
          <button type="button" className="feedCatalogGuestLink" onClick={onGuestPrompt}>
            Войдите
          </button>
          , чтобы увидеть сообщества.
        </div>
      ) : (
        <>
          {items === undefined ? (
            <FeedRailSkeleton rows={5} action />
          ) : items === null ? (
            <div className="feedSideEmpty">Не удалось загрузить.</div>
          ) : items.length === 0 ? (
            <div className="feedSideEmpty">Ничего не нашлось.</div>
          ) : (
            <ul className="feedCatalogList">
              {items.map((item) => {
                const subscribed = item.viewer_role !== null;
                return (
                  <li key={item.id} className="feedCatalogRow">
                    <button type="button" className="feedCatalogRowIdentity pressable" onClick={() => navigate(communityPath(item.slug))}>
                      <CommunityMark
                        className="feedCatalogRowMark"
                        kind={item.kind}
                        name={item.name}
                        website={item.website}
                        coverImageUrl={item.cover_image_url}
                      />
                      <span className="feedCatalogRowCopy">
                        <span className="feedCatalogRowName">{communityDisplayName(item.name)}</span>
                        <span className="feedCatalogRowCount">
                          {formatMemberCount(item.member_count)} · {Math.max(0, item.thread_count ?? 0)} тем
                        </span>
                      </span>
                    </button>
                    <div className="feedCatalogRowAction">
                      <Chip selected={subscribed} disabled={busyId === item.id} onClick={() => onToggle(item)}>
                        {subscribed ? "Вы здесь" : "Вступить"}
                      </Chip>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
          <a
            href={communitiesPath()}
            className="feedSideFootLink"
            onClick={(event) => {
              event.preventDefault();
              navigate(communitiesPath());
            }}
          >
            Все сообщества →
          </a>
        </>
      )}
    </div>
  );
}

function FeedRailSkeleton({ rows, action = false }: { rows: number; action?: boolean }) {
  return (
    <div className="feedRailSkeleton" role="status" aria-label="Загрузка блока">
      {Array.from({ length: rows }, (_, index) => (
        <span key={index} className="feedRailSkeletonRow" aria-hidden="true">
          <span className="feedRailSkeletonAvatar" />
          <span className="feedRailSkeletonCopy">
            <span style={{ width: index % 2 === 0 ? "78%" : "64%" }} />
            <span style={{ width: index % 2 === 0 ? "52%" : "44%" }} />
          </span>
          {action ? <span className="feedRailSkeletonAction" /> : null}
        </span>
      ))}
    </div>
  );
}

function SearchIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="10.5" cy="10.5" r="6" stroke="currentColor" strokeWidth="1.7" />
      <path d="m15 15 4.5 4.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}
