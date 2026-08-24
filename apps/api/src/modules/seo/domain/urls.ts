// Публичные базовые URL и canonical-пути витрины для SEO/шаринга (MF-505).
//
// Два разных хоста (docs/architecture/readme.md § «Окружения»):
//   web — 3mf.tech: сюда указывают canonical, og:url и все <loc> в sitemap; страницы,
//         которые видит человек (SPA) и куда nginx по UA пускает краулера на мета-эндпоинт.
//   api — api.3mf.tech: здесь живут сами SEO-ручки и публичная og-картинка (og:image).
// ENV с продовым дефолтом — тот же паттерн, что WEB_APP_URL в server.ts и захардкоженный
// api-хост в auth/plagid.ts.

export function webBaseUrl(): string {
  return (process.env.WEB_APP_URL ?? "https://3mf.tech").replace(/\/+$/, "");
}

export function apiBaseUrl(): string {
  return (process.env.API_PUBLIC_URL ?? "https://api.3mf.tech").replace(/\/+$/, "");
}

// Canonical path-схема витрины «Проекты» (apps/web/src/router.ts, MF-524/MF-508): /project,
// /project/:id, /u/:username. Path-роутер сменил хэш на History API и заодно упростил схему —
// модель живёт прямо на /project/:id, без промежуточного /model/.
export function catalogPath(tag?: string): string {
  return tag ? `/project?tag=${encodeURIComponent(tag)}` : "/project";
}

export function modelCanonicalPath(id: string): string {
  return `/project/${encodeURIComponent(id)}`;
}

export function profileCanonicalPath(username: string): string {
  return `/u/${encodeURIComponent(username)}`;
}

// Канонический путь карточки идеи (docs/design/ideas.md §1 «Маршрут», MF-946): `/issue/:id`,
// не `/ideas/:id` — API-домен и публичный маршрут страницы называются по-разному (routes.ts).
export function ideaCanonicalPath(id: string): string {
  return `/issue/${encodeURIComponent(id)}`;
}

// Абсолютный URL публичной og-картинки модели (webp-превью). Отдаётся api-ручкой
// /seo/models/:id/og.webp — только для опубликованных (status='ready') моделей, без сессии.
export function ogImageUrl(id: string): string {
  return `${apiBaseUrl()}/seo/models/${encodeURIComponent(id)}/og.webp`;
}
