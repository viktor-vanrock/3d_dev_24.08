// CI-гейт "installable PWA" (MF-432, готово-критерий фазы 1: "PR-пайплайн падает, если
// apps/web не проходит Lighthouse PWA — installable, valid manifest, зарегистрированный SW,
// offline-fallback").
//
// НЕ использует lighthouse per se: начиная с Lighthouse 10 (у нас в devDependencies —
// 13.x) аудиты installable-manifest/service-worker/splash-screen/themed-omnibox/
// maskable-icon ПОЛНОСТЬЮ убраны из ядра (проверено — их файлов нет в
// node_modules/lighthouse/core/audits/**), категория "pwa" не существует. Раскатывать
// живой headless Chrome в CI ради этого бессмысленно и рискованно (голый ubuntu-раннер,
// docs/infra/cicd.md — новый апт-пакет/экшен для Chrome не подтверждён). Вместо этого —
// статическая проверка ПОСТРОЕННОГО dist/ по тем же самым критериям: она детерминирована,
// не требует браузера и ловит именно те регрессии, которых боится этот гейт (сломанный
// манифест, невставленный SW, пустой прекэш).
//
// Запуск: pnpm --filter @portal/web run build && pnpm --filter @portal/web run pwa:audit
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const distDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "dist");

function fail(message) {
  console.error(`✗ ${message}`);
  process.exitCode = 1;
}

function ok(message) {
  console.warn(`✓ ${message}`);
}

async function checkManifest() {
  const manifestPath = path.join(distDir, "manifest.webmanifest");
  if (!existsSync(manifestPath)) return fail("manifest.webmanifest отсутствует в dist/");

  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const required = ["name", "short_name", "start_url", "display", "theme_color", "background_color", "icons"];
  const missing = required.filter((key) => !manifest[key]);
  if (missing.length > 0) return fail(`manifest.webmanifest: нет полей ${missing.join(", ")}`);

  if (manifest.display !== "standalone") return fail(`manifest.webmanifest: display=${manifest.display}, ожидался "standalone"`);

  const hasAny512 = manifest.icons.some((icon) => icon.sizes === "512x512" && (icon.purpose ?? "any").includes("any"));
  const hasMaskable = manifest.icons.some((icon) => (icon.purpose ?? "").includes("maskable"));
  if (!hasAny512) return fail("manifest.webmanifest: нет иконки 512x512 purpose=any (требование installability)");
  if (!hasMaskable) return fail("manifest.webmanifest: нет maskable-иконки (Android adaptive icon)");

  for (const icon of manifest.icons) {
    const iconPath = path.join(distDir, icon.src.replace(/^\//, ""));
    if (!existsSync(iconPath)) return fail(`manifest.webmanifest: иконка ${icon.src} не найдена в dist/`);
  }

  ok("manifest.webmanifest валиден (name/icons/display:standalone/theme_color), все иконки на месте");
}

async function checkServiceWorker() {
  const swPath = path.join(distDir, "sw.js");
  if (!existsSync(swPath)) return fail("dist/sw.js отсутствует — service worker не собран");

  const src = await readFile(swPath, "utf8");
  const precacheMatch = src.match(/\[\{"revision":.*?\}\]/s);
  if (!precacheMatch) return fail("dist/sw.js: не нашли встроенный precache-манифест (self.__WB_MANIFEST)");

  let precacheEntries;
  try {
    precacheEntries = JSON.parse(precacheMatch[0]);
  } catch {
    return fail("dist/sw.js: precache-манифест не парсится как JSON");
  }
  if (precacheEntries.length === 0) return fail("dist/sw.js: precache-манифест пуст — app-shell не закэшируется");
  if (!precacheEntries.some((e) => e.url === "index.html")) return fail("dist/sw.js: index.html не в precache — офлайн-фоллбэк не сработает");

  ok(`dist/sw.js собран, precache ${precacheEntries.length} записей (app-shell, включая index.html)`);
}

async function checkOfflineRuntimeCaching() {
  const swPath = path.join(distDir, "sw.js");
  const src = await readFile(swPath, "utf8");

  // Имена кэшей — строковые литералы sw.ts, минификатор их не переименовывает (в отличие
  // от идентификаторов классов Workbox) — надёжный маркер, что рантайм-роуты реально
  // попали в бандл, а не были случайно затришейканы.
  const expectedCaches = ["feed", "model-cards", "thumbnails"];
  const missing = expectedCaches.filter((name) => !src.includes(`"${name}"`));
  if (missing.length > 0) return fail(`dist/sw.js: не нашли рантайм-кэш(и) ${missing.join(", ")} — офлайн-слой не собрался`);

  ok("dist/sw.js содержит рантайм-кэши ленты/карточек/превью (feed, model-cards, thumbnails)");
}

async function main() {
  if (!existsSync(distDir)) {
    fail(`dist/ не найден (${distDir}) — сначала pnpm --filter @portal/web run build`);
    process.exit(1);
  }
  await checkManifest();
  await checkServiceWorker();
  await checkOfflineRuntimeCaching();
  if (process.exitCode) {
    console.error("\nPWA-гейт провален — см. ✗ выше.");
    process.exit(1);
  }
  console.warn("\nPWA-гейт зелёный.");
}

await main();
