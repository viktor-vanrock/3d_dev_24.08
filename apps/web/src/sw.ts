/// <reference lib="webworker" />
export {};
declare const self: ServiceWorkerGlobalScope;

// Офлайн-слой по типам ресурсов (MF-432, docs/epics/3mf.storage.md антипиратский пункт).
// Стратегии:
//  - app-shell (index.html + JS/CSS/шрифты чанки Vite) — precache + cache-first через
//    NavigationRoute (SPA: любой путь получает precached index.html, дальше маршрутизирует
//    клиентский router.ts).
//  - лента/карточки (GET /models, GET /models/:id) — network-first с фоллбэком на кэш:
//    видно последнее известное состояние офлайн, но онлайн всегда приоритет (свежие данные).
//  - превью-картинки каталога (GET /models/:id/thumb.webp) — stale-while-revalidate,
//    ExpirationPlugin режет по кол-ву/возрасту (Safari строг к квотам, storage.ts §persist).
//  - НИЧЕГО больше не кэшируется явно: preview.glb (геометрия) и любые /download,
//    /files/:role/download, presigned-путь исходника — НЕ регистрируем роут, запрос идёт
//    в сеть напрямую и это единственно верное поведение (антипиратство: source-роль никогда
//    не должна лежать в Cache Storage). Если сети нет — эти операции просто падают, и
//    экран должен показать «нужна сеть» (см. pwa/online.ts на стороне приложения).
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from "workbox-precaching";
import { NavigationRoute, registerRoute } from "workbox-routing";
import { CacheableResponsePlugin } from "workbox-cacheable-response";
import { ExpirationPlugin } from "workbox-expiration";
import { NetworkFirst, StaleWhileRevalidate } from "workbox-strategies";

precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();

// VITE_API_URL бывает трёх видов: пусто (dev-мок, same-origin), отдельный (суб)домен
// (api.3mf.tech, deploy/portal.deploy*.sh) и путь-префикс на своём origin ("/api" за
// реверс-прокси). Поэтому разбираем его относительно self.location и сверяем и origin,
// и префикс пути — иначе правила ниже молча не срабатывают и офлайн-кэша нет.
const API_BASE = new URL(import.meta.env.VITE_API_URL ?? "", self.location.origin);
const API_PREFIX = API_BASE.pathname.replace(/\/$/, "");

// Путь запроса относительно базы API, либо null — запрос не к API.
function apiPath(url: URL): string | null {
  if (url.origin !== API_BASE.origin) return null;
  if (!API_PREFIX) return url.pathname;
  if (url.pathname === API_PREFIX) return "/";
  return url.pathname.startsWith(`${API_PREFIX}/`) ? url.pathname.slice(API_PREFIX.length) : null;
}

// SPA-навигации: cache-first на прекэшенный index.html (app-shell), нет сети — юзер всё
// равно видит оболочку приложения, а не браузерную "нет соединения". Клиентский роутер
// (router.ts) сам решает, что рисовать дальше.
registerRoute(new NavigationRoute(createHandlerBoundToURL("/index.html")));

// Лента каталога: GET /models (со всеми query-вариантами тегов/сортировки).
registerRoute(
  ({ url, request }) => request.method === "GET" && apiPath(url) === "/models",
  new NetworkFirst({
    cacheName: "feed",
    networkTimeoutSeconds: 4,
    plugins: [new CacheableResponsePlugin({ statuses: [200] }), new ExpirationPlugin({ maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 })],
  }),
);

// Открытая карточка модели: GET /models/:id (детальный экран market/model.tsx).
registerRoute(
  ({ url, request }) => {
    const path = apiPath(url);
    return request.method === "GET" && path !== null && /^\/models\/[^/]+$/.test(path);
  },
  new NetworkFirst({
    cacheName: "model-cards",
    networkTimeoutSeconds: 4,
    plugins: [
      new CacheableResponsePlugin({ statuses: [200] }),
      new ExpirationPlugin({ maxEntries: 60, maxAgeSeconds: 60 * 60 * 24 * 7 }),
    ],
  }),
);

// Превью-иконки каталога: GET /models/:id/thumb.webp (растровая картинка, не геометрия —
// единственный тип превью-ассета, разрешённый к офлайн-кэшу правилом антипиратства выше).
registerRoute(
  ({ url, request }) => {
    const path = apiPath(url);
    return request.method === "GET" && path !== null && /^\/models\/[^/]+\/thumb\.webp$/.test(path);
  },
  new StaleWhileRevalidate({
    cacheName: "thumbnails",
    plugins: [
      new CacheableResponsePlugin({ statuses: [200] }),
      new ExpirationPlugin({ maxEntries: 300, maxAgeSeconds: 60 * 60 * 24 * 30 }),
    ],
  }),
);

// Обновление SW по явному согласию (registerType:"prompt", vite.config.ts) — страница шлёт
// SKIP_WAITING только после того, как юзер нажал «Обновить» в toast (pwa/update.ts), не сразу.
self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});

// Веб-пуш (MF-434, Фаза 3 эпика MF-42): payload — { title, body, deepLink } из
// apps/api/src/push/contract.ts::PushPayload. Показ нотификации — нативный UI
// браузера/ОС, не наш CSS, поэтому не требует спеки Design (та нужна для
// тумблеров подписки в ЛК, см. push/push.ts).
interface PushNotificationPayload {
  title: string;
  body: string;
  deepLink: string;
}

self.addEventListener("push", (event) => {
  let payload: PushNotificationPayload = { title: "3mf.tech", body: "", deepLink: "/" };
  try {
    if (event.data) payload = { ...payload, ...(event.data.json() as Partial<PushNotificationPayload>) };
  } catch {
    // Битый/нестандартный payload — показываем дефолт, не роняем событие.
  }
  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      data: { deepLink: payload.deepLink },
    }),
  );
});

// Тап по пуш-нотификации открывает карточку из уведомления (MF-434 §3
// «deep-link»): фокусируем уже открытую вкладку и просим клиент перейти по
// deepLink через postMessage (router.ts живёт в странице, не в SW), либо
// открываем новую вкладку сразу на нужном пути, если открытой нет.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const deepLink = (event.notification.data as { deepLink?: string } | undefined)?.deepLink ?? "/";

  event.waitUntil(
    (async () => {
      const clientsList = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const existing = clientsList[0];
      if (existing) {
        await existing.focus();
        existing.postMessage({ type: "PUSH_NAVIGATE", deepLink });
        return;
      }
      await self.clients.openWindow(deepLink);
    })(),
  );
});