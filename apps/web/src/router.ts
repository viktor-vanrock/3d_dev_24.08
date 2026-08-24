import { useEffect, useState } from "react";
import { flushSync } from "react-dom";
import type { HeaderMode } from "@platform/nav/types.ts";
type ModelSort = "new" | "popular";
import { prefersReducedMotionNow } from "@platform/theme";

const MODEL_SORTS: readonly ModelSort[] = ["new", "popular"];

// Path-роутер витрины «Проекты» (MF-524, эпик MF-508). Витрина переехала с hash `#/market`
// на публичный path `/project` (+ `/project/:id` для карточки) — это ссылки, которые уходят
// наружу и должны работать при прямом заходе и F5. Serving: nginx отдаёт `index.html` на
// `/project` и `/project/*` (см. deploy/nginx/3mf.tech.conf), SPA сама парсит `location.pathname`.
//
// История: до MF-524 здесь был ~30-строчный hash-парсер (`#/market`, `#/market/model/:id`,
// `#/u/:username`) — архитектор эпика marketplace.md §1 (GAP-NAV-2) счёл, что для нескольких
// экранов hash-роутер без react-router достаточен. Path-режим нужен именно ради публичного
// deep-link `/project`. Легаси-hash-ссылки уже разошлись в проде — мигрируем их на новые пути
// один раз при загрузке (см. migrateLegacyHash), чтобы старые закладки не ломались.

// Вкладки соцслоя страницы модели (IA-разгрузка MF-476, marketplace.v2.md §9.5 п.2): каждая —
// deep-linkable под-маршрут `/project/:id/{tab}`. "comments" — дефолт, живёт на голом
// `/project/:id` без суффикса (см. parseLocation/modelPath).
export type ModelTab = "comments" | "makes" | "stats";

// Сегменты очереди `/research` (MF-916, docs/design/research.workbench.md §1.2) — порядок
// значимости работы, состояние живёт в `?scope=`. Экспортируется — researchscreen.tsx/api.ts
// используют тот же union, что и парсер пути, одним источником правды.
export type ResearchScope = "mine" | "brand" | "gaps" | "low_confidence" | "flagged" | "all";
export const RESEARCH_SCOPES: readonly ResearchScope[] = ["mine", "brand", "gaps", "low_confidence", "flagged", "all"];

// Скоуп ленты /feed (feed.md §1.2 «Всё» / «Мои подписки») — тот же приём валидации, что
// ResearchScope выше; "all" — дефолт, не пишется в URL (feedPath()).
export type FeedListScope = "all" | "subscribed";
export const FEED_LIST_SCOPES: readonly FeedListScope[] = ["all", "subscribed"];

export type LegalSlug = "license" | "privacy" | "terms";
export const LEGAL_SLUGS: readonly LegalSlug[] = ["license", "privacy", "terms"];

export type Route =
  | { screen: "home" }
  | { screen: "market"; tag?: string; q?: string; sort?: ModelSort }
  | { screen: "model"; id: string; tab?: ModelTab }
  | { screen: "project-build"; id: string; config?: string }
  | { screen: "project-studio"; id: string; view?: string; source?: string }
  | { screen: "purchase-return"; id: string }
  | { screen: "add" }
  | { screen: "makes" }
  | { screen: "make"; id: string }
  | { screen: "profile"; username: string }
  | { screen: "own-profile" }
  | { screen: "avatar-editor" }
  | { screen: "legal"; slug: LegalSlug }
  | { screen: "generate"; genId?: string }
  | { screen: "assistant-chats" }
  | { screen: "assistant-workshop"; threadId: string }
  | { screen: "kitchen-sink" }
  | { screen: "printer-face" }
  | { screen: "catalog-metrics" }
  | { screen: "product-health" }
  | { screen: "material-candidates" }
  | { screen: "feed"; scope?: FeedListScope; community?: string }
  | { screen: "feed-post"; id: string }
  | { screen: "feed-new"; model?: string }
  | { screen: "printers"; view?: "new" }
  | { screen: "printer"; slug: string }
  | { screen: "materials" }
  | { screen: "material"; id: string }
  | { screen: "printer-compare"; ids: string[] }
  | { screen: "printer-releases" }
  | { screen: "printer-device"; id: string }
  | { screen: "printer-device-missing" }
  | { screen: "park" }
  | { screen: "park-add" }
  | { screen: "slice-print"; sliceId: string }
  | { screen: "plate"; modelId?: string; artifactId?: string; stepId?: string }
  | { screen: "printer-diy"; printerId: string }
  | { screen: "printer-community-firmware"; printerId: string }
  | { screen: "research"; scope?: ResearchScope }
  | { screen: "research-form"; slug?: string; draft?: string }
  | { screen: "communities" }
  | { screen: "community"; slug: string }
  | { screen: "thread"; id: string }
  | { screen: "moderation" }
  // Лента идей `/issue` (MF-945, docs/design/ideas.md §1) + карточка идеи `/issue/:id`
  // (MF-946, экран "idea") + форма подачи `/issue/new` (MF-947, §4).
  | { screen: "issue" }
  | { screen: "idea"; id: string }
  | { screen: "issue-new" };

// pushState не поднимает `popstate` — навигация внутри приложения шлёт это событие сама.
const LOCATION_EVENT = "locationchange";

// Экспортируется для юнит-тестов (router.test.tsx) — чистая функция без побочных эффектов.
export function parseLocation(pathname: string, search: string): Route {
  const parts = pathname.split("/").filter(Boolean);

  if (parts[0] === "purchases" && parts[1]) {
    return { screen: "purchase-return", id: decodeURIComponent(parts[1]) };
  }

  // Публичные юр. документы (docs/design/footer.md §5): принимаем только три опубликованных
  // slug, неизвестный путь остаётся обычным fallback, а не пустой страницей.
  if (parts[0] === "legal" && (LEGAL_SLUGS as readonly string[]).includes(parts[1] ?? "")) {
    return { screen: "legal", slug: parts[1] as LegalSlug };
  }

  // /project/add — флоу «Добавить модель» (MF-476, marketplace.v2.md §9.5 п.1): проверяем
  // ДО общего /project/:id, иначе "add" читается как id модели.
  if (parts[0] === "project" && parts[1] === "add") {
    return { screen: "add" };
  }
  // /makes — глобальная галерея опубликованных Make (MF-777, слайс Фазы 3 MF-395), ДО общего
  // /project/:id — своя ветка, не под-путь модели.
  if (parts[0] === "makes" && parts[1]) {
    return { screen: "make", id: decodeURIComponent(parts[1]) };
  }
  if (parts[0] === "makes" && !parts[1]) {
    return { screen: "makes" };
  }
  // Личная сборочная сессия — отдельный уровень после публичного лендинга проекта.
  // Проверяем до общего /project/:id/:tab, иначе `build` потеряется как неизвестная вкладка.
  if (parts[0] === "project" && parts[1] && parts[2] === "build") {
    const config = new URLSearchParams(search).get("config");
    return { screen: "project-build", id: decodeURIComponent(parts[1]), config: config ?? undefined };
  }
  // Авторская мастерская проекта: импорт Git, конфигурации, BOM, инструкция и релиз.
  // Стоит до общего `/project/:id`, иначе `studio` потеряется как неизвестная вкладка.
  if (parts[0] === "project" && parts[1] && parts[2] === "studio") {
    const params = new URLSearchParams(search);
    return {
      screen: "project-studio",
      id: decodeURIComponent(parts[1]),
      view: params.get("view") ?? undefined,
      source: params.get("source") ?? undefined,
    };
  }
  if (parts[0] === "project" && parts[1]) {
    const rawTab = parts[2];
    const tab: ModelTab | undefined = rawTab === "comments" || rawTab === "makes" || rawTab === "stats" ? rawTab : undefined;
    return { screen: "model", id: decodeURIComponent(parts[1]), tab };
  }
  // `/market` остаётся публичным алиасом витрины для внешних ссылок (MF-1630).
  // Внутренняя навигация и новые ссылки сохраняют канонический `/project`.
  if ((parts[0] === "project" || parts[0] === "market") && !parts[1]) {
    const params = new URLSearchParams(search);
    const tag = params.get("tag");
    // Первые ссылки на `/market` расходились с `search=`, а текущий канон использует `q=`.
    // Принимаем оба имени, не меняя адресную строку и не ломая back/forward.
    const q = params.get("q") ?? params.get("search");
    const sortParam = params.get("sort");
    const sort = (MODEL_SORTS as readonly string[]).includes(sortParam ?? "") ? (sortParam as ModelSort) : undefined;
    return { screen: "market", tag: tag ?? undefined, q: q ?? undefined, sort };
  }
  // /feed/new — ДО общего /feed/p/:id, иначе "new" читается как id поста (тот же приём, что
  // /project/add выше). /feed/p/:id — открытие поста во весь экран (feed.post.editor.md §0/§1).
  if (parts[0] === "feed" && parts[1] === "new") {
    const model = new URLSearchParams(search).get("model");
    return { screen: "feed-new", model: model ?? undefined };
  }
  if (parts[0] === "feed" && parts[1] === "p" && parts[2]) {
    return { screen: "feed-post", id: decodeURIComponent(parts[2]) };
  }
  // `/news` — публичный алиас пункта верхнего меню «Новости» (MF-790, frame.md §2).
  // Канонический путь остаётся `/feed`, поэтому оба адреса используют один экран и scope.
  if ((parts[0] === "feed" || parts[0] === "news") && !parts[1]) {
    const params = new URLSearchParams(search);
    const community = params.get("community");
    if (community) return { screen: "feed", community };
    const scopeParam = params.get("scope");
    const scope = (FEED_LIST_SCOPES as readonly string[]).includes(scopeParam ?? "") ? (scopeParam as FeedListScope) : undefined;
    return { screen: "feed", scope };
  }
  // /park/add — мастер «добавить принтер» (MF-903, docs/design/printer.wizard.md §0): роут, не
  // оверлей — диплинк/шара/«назад» должны работать. Проверяем ДО общего /printers* ниже (другой
  // сегмент, но ставим рядом по смыслу маршрутов принтеров).
  if (parts[0] === "park" && parts[1] === "add") {
    return { screen: "park-add" };
  }
  if (parts[0] === "slice" && parts[1] && parts[2] === "print") {
    return { screen: "slice-print", sliceId: decodeURIComponent(parts[1]) };
  }
  // Плита стола `/plate` (MF-1094, «Веб-слайсер»): 3D-редактор раскладки + отправка джобы —
  // upstream шаг перед уже собранным slicePrintPath() выше (`/slice/:id/print`, MF-1075/1078).
  // `?model=` — префилл с карточки модели («Отправить в печать», market/model.tsx).
  if (parts[0] === "plate" && !parts[1]) {
    const params = new URLSearchParams(search);
    const modelId = params.get("model");
    const artifactId = params.get("artifact");
    const stepId = params.get("step");
    return {
      screen: "plate",
      modelId: modelId ?? undefined,
      ...(artifactId ? { artifactId } : {}),
      ...(stepId ? { stepId } : {}),
    };
  }
  // /park — список парка (MF-1077, docs/design/park.md §1): проверяем ПОСЛЕ /park/add выше,
  // иначе тот бы никогда не сработал.
  if (parts[0] === "park" && !parts[1]) {
    return { screen: "park" };
  }
  // /printers/:id/diy и /printers/:id/community-firmware — два экрана-выхода для
  // неподдержанных моделей (printer.wizard.md §5): реальные роуты, проверяем ДО общей
  // заглушки /printers* ниже, иначе "diy"/"community-firmware" читались бы как id.
  if (parts[0] === "printers" && parts[1] && parts[2] === "diy") {
    return { screen: "printer-diy", printerId: decodeURIComponent(parts[1]) };
  }
  if (parts[0] === "printers" && parts[1] && parts[2] === "community-firmware") {
    return { screen: "printer-community-firmware", printerId: decodeURIComponent(parts[1]) };
  }
  // `/materials/:id` — каноническая карточка материала принимает UUID, но парсер не
  // валидирует его: 404 должен решать detail API, а прямой deep-link не должен падать в home.
  if (parts[0] === "materials" && parts[1]) {
    return { screen: "material", id: decodeURIComponent(parts[1]) };
  }
  if (parts[0] === "materials") {
    return { screen: "materials" };
  }
  // /printer/ без id — явное состояние ошибки, не домашняя страница (MF-1367/MF-953).
  if (parts[0] === "printer" && !parts[1]) {
    return { screen: "printer-device-missing" };
  }
  // /printer/:id — живая страница СВОЕГО устройства из парка (MF-953, брешь №2 firmware.pilot.md,
  // не путать с каталожным /printers/:slug ниже — другой сегмент, единственное число).
  if (parts[0] === "printer" && parts[1]) {
    return { screen: "printer-device", id: decodeURIComponent(parts[1]) };
  }
  // /printers/compare?ids=a,b,c — сравнение (MF-927, nav.sections.md §3.5), ДО общего
  // /printers/:slug ниже, иначе "compare" читался бы как slug принтера.
  if (parts[0] === "printers" && parts[1] === "compare") {
    const ids = (new URLSearchParams(search).get("ids") ?? "").split(",").filter(Boolean);
    return { screen: "printer-compare", ids };
  }
  // /printers/releases — календарь новинок (MF-833, docs/design/printers.md §2), ДО общего
  // /printers/:slug ниже, иначе "releases" читался бы как slug принтера. Заменяет старую
  // заглушку `/printers?view=new` (переключатель шапки теперь ведёт сюда напрямую).
  if (parts[0] === "printers" && parts[1] === "releases") {
    return { screen: "printer-releases" };
  }
  // /printers/<slug> — карточка принтера (MF-927, docs/design/printers.catalog.md §4).
  if (parts[0] === "printers" && parts[1]) {
    return { screen: "printer", slug: decodeURIComponent(parts[1]) };
  }
  // /printers — фасетный каталог (MF-927, docs/design/printers.catalog.md). `?view=new` —
  // переключатель «Каталог · Новинки» (§1.1), состояние в URL, дефолт — «Каталог».
  if (parts[0] === "printers") {
    const view = new URLSearchParams(search).get("view");
    return { screen: "printers", view: view === "new" ? "new" : undefined };
  }
  // /research/new — форма создания с предзаполнением из строки поиска (§1.3), ДО общего
  // /research/:slug ниже, тот же приём, что /project/add. /research/:slug — форма карточки
  // (MF-916 п.6: заглушка, реальная форма — отдельная карточка Front), /research — очередь работ
  // (docs/design/research.workbench.md §1), сегмент — `?scope=`, валидируется по RESEARCH_SCOPES.
  if (parts[0] === "research" && parts[1] === "new") {
    const draft = new URLSearchParams(search).get("draft");
    return { screen: "research-form", draft: draft ?? undefined };
  }
  if (parts[0] === "research" && parts[1]) {
    return { screen: "research-form", slug: decodeURIComponent(parts[1]) };
  }
  if (parts[0] === "research") {
    const scopeParam = new URLSearchParams(search).get("scope");
    const scope = (RESEARCH_SCOPES as readonly string[]).includes(scopeParam ?? "") ? (scopeParam as ResearchScope) : undefined;
    return { screen: "research", scope };
  }
  // /community/:slug — страница сообщества (community.md §0), /community — список,
  // /thread/:id — страница треда (свой top-level сегмент, не под /community — спека §0
  // держит их раздельно, тред не обязательно листается через саб-страницу).
  if (parts[0] === "community" && parts[1]) {
    return { screen: "community", slug: decodeURIComponent(parts[1]) };
  }
  if (parts[0] === "community" || parts[0] === "communities") {
    return { screen: "communities" };
  }
  if (parts[0] === "thread" && parts[1]) {
    return { screen: "thread", id: decodeURIComponent(parts[1]) };
  }
  // Внутренняя очередь модерации (MF-416): отдельный верхнеуровневый маршрут,
  // чтобы не пересекаться с публичным `/community/:slug` и оставаться deep-link.
  if (parts[0] === "moderation" && !parts[1]) {
    return { screen: "moderation" };
  }
  // /issue/new — форма подачи идеи (MF-947, docs/design/ideas.md §4): своя мини-шапка/light-режим,
  // тот же приём, что /project/add выше — проверяем ДО общего /issue/:id.
  if (parts[0] === "issue" && parts[1] === "new") {
    return { screen: "issue-new" };
  }
  // /issue/:id — страница идеи (docs/design/ideas.md §3, MF-946, стейдж 2 карточки MF-562).
  if (parts[0] === "issue" && parts[1]) {
    return { screen: "idea", id: decodeURIComponent(parts[1]) };
  }
  // /issue — лента идей (MF-945, ideas.md §1 «Маршрут — канонический», директива MF-564).
  if (parts[0] === "issue") {
    return { screen: "issue" };
  }
  // /ideas → 301 на /issue (только для внешних/старых ссылок, ideas.md §1) — сама навигация
  // портала уже линкует на /issue напрямую (issuePath/issueNewPath). Адрес-бар переписывает
  // migrateLegacyIdeasPath() ниже (тот же приём, что migrateLegacyHash), здесь просто читаем
  // тот же экран, чтобы первый рендер (до эффекта) уже не мигал home.
  if (parts[0] === "ideas" && parts[1]) {
    return { screen: "idea", id: decodeURIComponent(parts[1]) };
  }
  if (parts[0] === "ideas") {
    return { screen: "issue" };
  }
  // `/profile` — стабильный вход в свой ЛК из подвала; username берётся после AuthGate в
  // app.tsx. Публичные `/u/:username` остаются ссылками на конкретный профиль.
  if (parts[0] === "avatar" && !parts[1]) return { screen: "avatar-editor" };
  if (parts[0] === "profile" && parts[1] === "avatar" && !parts[2]) return { screen: "avatar-editor" };
  if (parts[0] === "profile" && !parts[1]) return { screen: "own-profile" };
  if (parts[0] === "u" && parts[1]) return { screen: "profile", username: decodeURIComponent(parts[1]) };
  if ((parts[0] === "giga" || parts[0] === "chats") && !parts[1]) return { screen: "assistant-chats" };
  if (parts[0] === "giga" && parts[1]) {
    return { screen: "assistant-workshop", threadId: decodeURIComponent(parts[1]) };
  }
  if (parts[0] === "workshop" && parts[1] === "3d" && parts[2]) {
    return { screen: "assistant-workshop", threadId: decodeURIComponent(parts[2]) };
  }
  if (parts[0] === "generate") {
    const genId = new URLSearchParams(search).get("gen");
    return { screen: "generate", genId: genId ?? undefined };
  }
  if (parts[0] === "kitchen-sink") return { screen: "kitchen-sink" };
  // /face — морда принтера (MF-926, docs/design/printer.face.md §2): отдельный артефакт вне IA
  // портала (задизайнено жить своим пакетом, но допустимо держать под скрытым роутом apps/web,
  // §2.1 спеки), недоступен из обычной навигации, тот же приём, что /kitchen-sink — стенд-роут,
  // без auth-гейта, чтобы визуал сверялся без PlagID-логина.
  if (parts[0] === "face") return { screen: "printer-face" };
  if (parts[0] === "internal" && parts[1] === "catalog-metrics") return { screen: "catalog-metrics" };
  if (parts[0] === "internal" && parts[1] === "product-health") return { screen: "product-health" };
  if (parts[0] === "internal" && parts[1] === "material-candidates") return { screen: "material-candidates" };
  return { screen: "home" };
}

// Легаси-hash (#/market...) → новый path, либо null если hash не наш роут.
// Экспортируется для юнит-тестов (router.test.tsx).
export function legacyHashToPath(hash: string): string | null {
  if (!hash.startsWith("#/")) return null;
  const raw = hash.slice(1); // убираем '#', оставляем ведущий '/'
  const [path, query] = raw.split("?");
  const parts = (path ?? "").split("/").filter(Boolean);
  const qs = query ? `?${query}` : "";

  if (parts[0] === "market" && parts[1] === "model" && parts[2]) {
    return `/project/${parts[2]}`;
  }
  if (parts[0] === "market") return `/project${qs}`;
  if (parts[0] === "u" && parts[1]) return `/u/${parts[1]}${qs}`;
  if (parts[0] === "kitchen-sink") return "/kitchen-sink";
  return `/${qs}`; // #/ → корень
}

// Разовая миграция старых hash-ссылок на path (replaceState — не плодим лишнюю запись в истории).
export function migrateLegacyHash(): void {
  const target = legacyHashToPath(window.location.hash);
  if (target === null) return;
  window.history.replaceState(null, "", target);
}

// `/ideas` → `/issue` 301-редирект (MF-945, ideas.md §1: канонический публичный URL — `/issue`,
// `/ideas` остаётся только для внешних/старых ссылок). Экспортируется для юнит-тестов, тот же
// приём, что legacyHashToPath — чистая функция pathname+search → новый path либо null.
export function legacyIdeasPathToIssuePath(pathname: string, search: string): string | null {
  const parts = pathname.split("/").filter(Boolean);
  if (parts[0] !== "ideas") return null;
  const qs = search && search !== "?" ? search : "";
  return parts[1] ? `/issue/${parts[1]}${qs}` : `/issue${qs}`;
}

// Переписывает адресную строку `/ideas...` на `/issue...` (replaceState — старая ссылка не
// плодит лишнюю запись в истории), тот же приём, что migrateLegacyHash.
export function migrateLegacyIdeasPath(): void {
  const target = legacyIdeasPathToIssuePath(window.location.pathname, window.location.search);
  if (target === null) return;
  window.history.replaceState(null, "", target);
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => {
    migrateLegacyHash();
    migrateLegacyIdeasPath();
    return parseLocation(window.location.pathname, window.location.search);
  });

  useEffect(() => {
    const update = () => {
      migrateLegacyHash();
      migrateLegacyIdeasPath();
      setRoute(parseLocation(window.location.pathname, window.location.search));
    };
    // popstate (назад/вперёд браузера, включая голый `window.history.back()` из feed/post.tsx
    // и modelviewer.tsx) — единственный путь смены роута, который раньше шёл мимо View
    // Transition: navigate() оборачивает pushState сам, а тут браузер уже сдвинул
    // pathname/history ДО этого колбэка, снапшот "до" ещё можно снять. Design-ревью MF-607
    // поймало живой рывок капсулы ровно на этом пути («В ленту» → history.back()). direction
    // фиксируем "back" — popstate почти всегда обратная навигация; forward-кейс (редкая кнопка
    // "Вперёд") получит тот же сдвиг, что и назад, это принятое упрощение.
    const onPopstate = () => {
      document.documentElement.dataset.navDir = "back";
      if (typeof document.startViewTransition !== "function" || prefersReducedMotionNow()) {
        if (prefersReducedMotionNow()) update();
        else runFallbackNavigation("back", update);
        return;
      }
      document.startViewTransition(() => flushSync(update));
    };
    // hashchange — заход по старой #/-ссылке уже в открытом приложении; LOCATION_EVENT — наша
    // navigate() (уже сама оборачивает свою pushState в transition, update() здесь голый).
    window.addEventListener("popstate", onPopstate);
    window.addEventListener("hashchange", update);
    window.addEventListener(LOCATION_EVENT, update);
    return () => {
      window.removeEventListener("popstate", onPopstate);
      window.removeEventListener("hashchange", update);
      window.removeEventListener(LOCATION_EVENT, update);
    };
  }, []);

  return route;
}

// Любая навигация (не только смена таба) — нативный View Transitions API, если браузер
// поддерживает и prefers-reduced-motion не активен (MF-607: переход превью↔фулскрин шапки —
// смена headerMode между экранами, `.homeCapsule`/`shell-capsule` в home.css, — раньше случалась
// только на переключении таба через navigateWithTransition, drill-down навигация (карточка
// модели, профиль, генерация) шла мимо неё голым pushState, поэтому капсула/кнопки прыгали).
// direction по умолчанию "fwd" — большинство навигаций идёт «вглубь» (в карточку модели,
// в генерацию); явные «назад»-переходы и переключение таба задают direction сами
// (navigateWithTransition/onSectionChange, app.tsx). flushSync — API ждёт СИНХРОННОЕ
// обновление DOM внутри колбэка, а не следующий тик React. direction пишем на :root ДО
// перехода — CSS уже знает, куда сдвигать контент/пилюлю, когда браузер снимет «до/после»
// снапшоты (motion.md §2).
export function navigate(path: string, direction: "fwd" | "back" = "fwd"): void {
  document.documentElement.dataset.navDir = direction;
  if (typeof document.startViewTransition !== "function" || prefersReducedMotionNow()) {
    const update = () => {
      window.history.pushState(null, "", path);
      window.dispatchEvent(new Event(LOCATION_EVENT));
    };
    if (prefersReducedMotionNow()) update();
    else runFallbackNavigation(direction, update);
    return;
  }
  document.startViewTransition(() => {
    flushSync(() => {
      window.history.pushState(null, "", path);
      window.dispatchEvent(new Event(LOCATION_EVENT));
    });
  });
}

// Переход между разделами Дом⇄Проекты (motion.md §2) — тот же механизм, что navigate(), только
// с явным направлением (реестр NAV_ITEMS, app.tsx), а не дефолтным "fwd".
export function navigateWithTransition(path: string, direction: "fwd" | "back"): void {
  navigate(path, direction);
}

let fallbackNavigationTimer: ReturnType<typeof setTimeout> | null = null;

// Встроенный браузер Codex/WebKit сегодня не экспонирует View Transitions API. Без
// собственного пути смена React-экрана происходила одним кадром и выглядела как повторная
// загрузка шапки. Атрибут запускает CSS-анимацию уже на НОВОМ route-root; flushSync нужен
// по той же причине, что и в document.startViewTransition — DOM должен смениться внутри
// управляемой фазы. Повторный быстрый тап перезапускает анимацию, старый таймер не снимает
// атрибут у следующего перехода.
function runFallbackNavigation(direction: "fwd" | "back", update: () => void): void {
  const root = document.documentElement;
  delete root.dataset.navFallback;
  // Синхронное чтение отделяет две последовательные CSS-анимации одного атрибута.
  void root.offsetWidth;
  root.dataset.navFallback = direction;
  flushSync(update);
  if (fallbackNavigationTimer !== null) clearTimeout(fallbackNavigationTimer);
  fallbackNavigationTimer = setTimeout(() => {
    delete root.dataset.navFallback;
    fallbackNavigationTimer = null;
  }, 340);
}

export function marketSearch(filters?: { tag?: string; q?: string; sort?: ModelSort }): string {
  const params = new URLSearchParams();
  if (filters?.tag) params.set("tag", filters.tag);
  if (filters?.q) params.set("q", filters.q);
  if (filters?.sort && filters.sort !== "new") params.set("sort", filters.sort);
  const query = params.toString();
  return query ? `?${query}` : "";
}

export function marketPath(filters?: { tag?: string; q?: string; sort?: ModelSort }): string {
  return `/project${marketSearch(filters)}`;
}

export function modelPath(id: string, tab?: ModelTab): string {
  const base = `/project/${encodeURIComponent(id)}`;
  return tab ? `${base}/${tab}` : base;
}

export function projectBuildPath(id: string, config?: string): string {
  const base = `/project/${encodeURIComponent(id)}/build`;
  return config ? `${base}?config=${encodeURIComponent(config)}` : base;
}

export function projectStudioPath(id: string, options?: { view?: string; source?: string }): string {
  const params = new URLSearchParams();
  if (options?.view) params.set("view", options.view);
  if (options?.source) params.set("source", options.source);
  const query = params.toString();
  const base = `/project/${encodeURIComponent(id)}/studio`;
  return query ? `${base}?${query}` : base;
}

// Флоу «Добавить модель» на отдельной странице (MF-476, marketplace.v2.md §9.5 п.1) — заменяет
// модалку поверх каталога.
export function addModelPath(): string {
  return "/project/add";
}

// Галерея Make (MF-777). Своя точка входа в навигации ещё не назначена (нужна спека Design) —
// путь уже рабочий по прямой ссылке, тот же приём, что issuePath ниже до сборки страницы `/issue`.
export function makesPath(): string {
  return "/makes";
}

export function makePath(id: string): string {
  return `/makes/${encodeURIComponent(id)}`;
}

export function profilePath(
  username: string,
  tab?: "overview" | "projects" | "posts" | "workshop",
): string {
  const base = `/u/${encodeURIComponent(username)}`;
  return tab && tab !== "overview" ? `${base}?tab=${tab}` : base;
}

export function avatarEditorPath(): string {
  return "/profile/avatar";
}

// Лента /feed (MF-790/814/959, docs/design/feed.md §1). `scope` — «Мои подписки» пишется в URL
// (§1.2), "all"/undefined — дефолт, без query.
export function feedPath(scope?: FeedListScope, community?: string): string {
  if (community) return `/feed?community=${encodeURIComponent(community)}`;
  return scope && scope !== "all" ? `/feed?scope=${scope}` : "/feed";
}

// Раздел «Принтеры» (MF-851, nav.sections.md §3) — фасетный каталог (MF-927).
export function printersPath(): string {
  return "/printers";
}

// Карточка принтера `/printers/<slug>` (MF-927, docs/design/printers.catalog.md §4). `slug` —
// рабочий id из printer.schema.json (brand.model в lowercase через точки), не uuid.
export function printerPath(slug: string): string {
  return `/printers/${encodeURIComponent(slug)}`;
}

// Публичный каталог материалов и его detail-маршрут (docs/design/materials.catalog.md §4).
export function materialsPath(): string {
  return "/materials";
}
// Временная точка входа MF-2051: раздел уже называется общо, но первая готовая витрина —
// филаменты. Отдельный helper не размазывает `?kind=filament` по навигационным компонентам.
export function filamentsPath(): string {
  return "/materials?kind=filament";
}
export function materialPath(id: string): string {
  return `/materials/${encodeURIComponent(id)}`;
}

// Живая страница СВОЕГО принтера `/printer/:id` (MF-953) — `id` — uuid user_printers, не slug
// канона (тот — printerPath() выше, множественное число, другая сущность).
export function printerDevicePath(id: string): string {
  return `/printer/${encodeURIComponent(id)}`;
}

// Сравнение `/printers/compare?ids=a,b,c` (MF-927, nav.sections.md §3.5) — 2–4 id набора,
// живёт в URL целиком (шарибельно/«назад»-совместимо).
export function printerComparePath(ids: string[]): string {
  return `/printers/compare?ids=${ids.map(encodeURIComponent).join(",")}`;
}

// Календарь новинок `/printers/releases` (MF-833, docs/design/printers.md §2) — второе
// положение переключателя шапки «Каталог · Новинки», раньше было `?view=new` на этом же
// каталоге (printersPath({view:"new"})), теперь отдельный экран.
export function printerReleasesPath(): string {
  return "/printers/releases";
}

// Очередь работ ресёрчера (MF-916, research.workbench.md §1) — `scope` пишется в `?scope=` при
// переключении сегмента (§1.2), опущен для дефолтного входа.
export function researchPath(scope?: ResearchScope): string {
  return scope ? `/research?scope=${scope}` : "/research";
}

// Форма карточки принтера (MF-916 п.6: заглушка на этом экране, реальная форма — отдельная
// карточка Front) — тап по строке очереди ведёт сюда напрямую.
export function researchFormPath(slug: string): string {
  return `/research/${encodeURIComponent(slug)}`;
}

// Поиск-создание (§1.3): последняя строка выдачи «+ Создать карточку "…"» ведёт на
// `/research/new?draft=<ввод>` — заголовок формы предзаполняется тем, что искали.
export function researchNewPath(draft?: string): string {
  return draft ? `/research/new?draft=${encodeURIComponent(draft)}` : "/research/new";
}

// Мастер «добавить принтер» (MF-903, printer.wizard.md §2): `brand`/`model` — префилл с карточки
// модели («У меня такой», MF-892, ещё не собрана) — при заходе с префиллом шаг 1 пропускается
// (та же query-конвенция, что generatePath/feedNewPath). `machineId` — id из каталога `machines`
// (MF-32/437, PrinterPicker), нужен мастеру для сопоставления с каноном `printers` (§3.3).
export interface ParkAddPrefill {
  brand: string;
  model: string;
  machineId?: string;
  returnTo?: string;
  source?: "catalog";
}

// Список парка `/park` (MF-1077, docs/design/park.md §1) — все принтеры юзера, точка выхода
// из мастера (§1.4) и точка входа в `/park/add`/`/printer/:id`.
export function parkPath(): string {
  return "/park";
}

export function parkAddPath(prefill?: ParkAddPrefill): string {
  if (!prefill) return "/park/add";
  const params = new URLSearchParams({ brand: prefill.brand, model: prefill.model });
  if (prefill.machineId) params.set("machine_id", prefill.machineId);
  if (prefill.returnTo && isInternalPath(prefill.returnTo)) params.set("return_to", prefill.returnTo);
  if (prefill.source === "catalog") params.set("source", prefill.source);
  return `/park/add?${params.toString()}`;
}

// Плита стола `/plate` (MF-1094) — `modelId` префиллит первую модель на столе (карточка модели →
// «Отправить в печать»), без него открывается пустая плита (юзер добавляет модели сам).
export function platePath(
  modelId?: string,
  context?: { artifactId?: string; stepId?: string },
): string {
  if (!modelId && !context?.artifactId && !context?.stepId) return "/plate";
  const params: string[] = [];
  if (modelId) params.push(`model=${encodeURIComponent(modelId)}`);
  if (context?.artifactId) params.push(`artifact=${encodeURIComponent(context.artifactId)}`);
  if (context?.stepId) params.push(`step=${encodeURIComponent(context.stepId)}`);
  return `/plate?${params.join("&")}`;
}

export function slicePrintPath(sliceId: string, context?: Record<string, string>): string {
  const query = new URLSearchParams(context);
  const suffix = query.toString();
  return `/slice/${encodeURIComponent(sliceId)}/print${suffix ? `?${suffix}` : ""}`;
}

export function parseParkAddPrefill(search: string): ParkAddPrefill | undefined {
  const params = new URLSearchParams(search);
  const brand = params.get("brand");
  const model = params.get("model");
  if (!brand || !model) return undefined;
  const returnTo = params.get("return_to");
  return {
    brand,
    model,
    // `machine_id` — текущий URL-контракт каталога; `printer_id` оставляем совместимым
    // с уже разошедшимися deep-link и resume-ссылками мастера.
    machineId: params.get("machine_id") ?? params.get("printer_id") ?? undefined,
    returnTo: returnTo && isInternalPath(returnTo) ? returnTo : undefined,
    source: params.get("source") === "catalog" ? "catalog" : undefined,
  };
}

function isInternalPath(path: string): boolean {
  return path.startsWith("/") && !path.startsWith("//") && !path.includes("\\");
}

// Два экрана-выхода для неподдержанных моделей (printer.wizard.md §5) — реальные роуты,
// шарибельно/диплинк. `printerId` — опаковый идентификатор модели (slug канона `printers`,
// когда найден по §3.3-сопоставлению; иначе best-effort brand/model строка) — финальный
// нейминг не заблокирован (MF-900: «по согласованию Front/UX, не блокирует визуал»).
export function printerDiyPath(printerId: string): string {
  return `/printers/${encodeURIComponent(printerId)}/diy`;
}

export function printerCommunityFirmwarePath(printerId: string): string {
  return `/printers/${encodeURIComponent(printerId)}/community-firmware`;
}

// Страница поста (feed.post.editor.md §0) — `headerMode:'light'`, тот же приём modelPath.
export function feedPostPath(id: string): string {
  return `/feed/p/${encodeURIComponent(id)}`;
}

// Редактор/создание поста (feed.post.editor.md §0/§2.1). `model` — предзаполнение вложения
// с карточки модели («Рассказать в ленте», §2.1 п.4), тот же приём query-параметра, что generatePath.
export function feedNewPath(modelId?: string): string {
  return modelId ? `/feed/new?model=${encodeURIComponent(modelId)}` : "/feed/new";
}

// Форум (community.md, MF-931): список/сообщество/тред. communityPath() существовала раньше
// самого экрана (eyebrow поста уже ссылался на неё, feed.post.editor.md §1.3) — теперь `/community`
// и `/community/:slug`/`/thread/:id` разобраны в parseLocation выше.
export function communitiesPath(): string {
  return "/community";
}

export function communityPath(slug: string): string {
  return `/community/${encodeURIComponent(slug)}`;
}

export function threadPath(id: string): string {
  return `/thread/${encodeURIComponent(id)}`;
}

export function marketTagPath(tag: string): string {
  return `/project?tag=${encodeURIComponent(tag)}`;
}

export function generatePath(genId?: string): string {
  return genId ? `/generate?gen=${encodeURIComponent(genId)}` : "/generate";
}

export function assistantChatsPath(): string {
  return "/giga";
}

export function assistantWorkshopPath(threadId: string): string {
  return `/giga/${encodeURIComponent(threadId)}`;
}

// Контекст-пейлоад дверей входа фидбека → предзаполнение формы подачи (MF-694,
// docs/design/feedback.entrypoints.md §3.1). `/issue/new` роутится (MF-947, IdeaSubmitScreen) и
// читает контекст через parseIssueNewContext (title/category/type/ref → ContextChip/TypeToggle).
export interface IssueRef {
  type: string;
  id: string;
  title?: string;
}

export interface IssueNewContext {
  title?: string;
  category?: string;
  type?: "idea" | "problem";
  ref?: IssueRef;
}

export function issueNewPath(context?: IssueNewContext): string {
  if (!context) return "/issue/new";
  const params = new URLSearchParams();
  if (context.title) params.set("title", context.title);
  if (context.category) params.set("category", context.category);
  if (context.type) params.set("type", context.type);
  if (context.ref) {
    params.set("ref_type", context.ref.type);
    params.set("ref_id", context.ref.id);
    if (context.ref.title) params.set("ref_title", context.ref.title);
  }
  const qs = params.toString();
  return qs ? `/issue/new?${qs}` : "/issue/new";
}

export function parseIssueNewContext(search: string): IssueNewContext {
  const params = new URLSearchParams(search);
  const context: IssueNewContext = {};
  const title = params.get("title");
  const category = params.get("category");
  const type = params.get("type");
  const refType = params.get("ref_type");
  const refId = params.get("ref_id");
  if (title) context.title = title;
  if (category) context.category = category;
  if (type === "idea" || type === "problem") context.type = type;
  if (refType && refId) context.ref = { type: refType, id: refId, title: params.get("ref_title") ?? undefined };
  return context;
}

// Страница идеи (docs/design/ideas.md §1 «Маршрут» — канонический публичный URL `/issue/:id`).
// Сам маршрут ещё не зарегистрирован в parseLocation (MF-562, лента/страница «Идей» не собраны) —
// путь нужен уже сейчас поверхностям связующего слоя (MF-695 «Мои идеи» в профиле и т.д.), чтобы
// не городить временный формат ссылки, который потом придётся мигрировать.
export function issuePath(id: string): string {
  return `/issue/${encodeURIComponent(id)}`;
}

// Лента идей `/issue` (MF-945, ideas.md §1) — таб «Идеи»/CTA «В ленту» и т.п. ведут сюда, не на
// голый литерал "/issue" россыпью по вызывающим (тот же приём, что marketPath()/feedPath()).
export function issuesPath(): string {
  return "/issue";
}

// Контракт общей web-шапки: `presentation` — только Дом; `full` — рабочие страницы;
// `back` — иммерсив или сфокусированный экран только с возвратом; `mixed` — рабочая
// шапка плюс возврат. Киоск принтера остаётся самостоятельным device-shell.
export function headerModeFor(
  screen: Route["screen"],
  state?: { viewerFullscreen?: boolean; withBack?: boolean },
): HeaderMode {
  if (state?.viewerFullscreen) return "back";
  if (state?.withBack) return "mixed";
  switch (screen) {
    case "home":
      return "presentation";
    default:
      return "full";
  }
}
