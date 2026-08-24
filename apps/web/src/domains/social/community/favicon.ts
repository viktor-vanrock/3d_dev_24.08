// Keyless favicon бренда (MF-2039) — тот же приём Google s2/favicons, что уже используется для
// карточек источников в постах (feed/richbody.tsx#faviconUrl) и сайдбара "Мои сабы"
// (feedscreen.tsx). Вынесено сюда единым источником, чтобы страница сообщества
// (communityscreen.tsx) не заводила третью копию той же строки.
export function communityFaviconUrl(domain: string): string {
  return `https://www.google.com/s2/favicons?sz=64&domain=${encodeURIComponent(domain)}`;
}
