import { hasCurrentConsent, subscribeConsent } from "./consent.ts";

// Umami-трекер (MF-725/MF-728): same-origin прокси `/_a/` (docs/infra/readme.md
// §«Аналитика — Umami»), id сайта разный на dev/prod через VITE_UMAMI_WEBSITE_ID
// (apps/web/.env.example). Гейт на согласие — тот же баннер, что покрывает
// «поведенческую аналитику» целиком (docs/design/consent.md, MF-609/610): fail-closed,
// скрипт грузится только ПОСЛЕ granted; отзыв сразу глушит трекер флагом `umami.disabled`,
// который сам скрипт проверяет на каждой отправке события (не только при инициализации).
const WEBSITE_ID = import.meta.env.VITE_UMAMI_WEBSITE_ID;
const SCRIPT_ELEMENT_ID = "umami-tracker-script";
const DISABLED_KEY = "umami.disabled";

function loadScript(websiteId: string): void {
  if (document.getElementById(SCRIPT_ELEMENT_ID)) return;
  localStorage.removeItem(DISABLED_KEY);
  const script = document.createElement("script");
  script.id = SCRIPT_ELEMENT_ID;
  script.defer = true;
  script.src = "/_a/script.js";
  script.setAttribute("data-website-id", websiteId);
  document.head.appendChild(script);
}

function applyConsentState(websiteId: string): void {
  if (hasCurrentConsent()) loadScript(websiteId);
  else localStorage.setItem(DISABLED_KEY, "true");
}

// Нет id (не задан на этом окружении, например локальный pnpm dev) — трекер вообще
// не трогаем, включая disabled-флаг.
export function initUmamiTracking(): void {
  if (!WEBSITE_ID) return;
  applyConsentState(WEBSITE_ID);
  subscribeConsent(() => applyConsentState(WEBSITE_ID));
}
