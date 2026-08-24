// Лёгкий локальный гейт touch/contrast-инвариантов (docs/design/readme.md § «Компоненты и
// токены: как применять», MF-903-смежная задача). НЕ замена autofab-a11y (axe-core живой аудит
// DOM) — та ловит реальную разметку/aria, этот скрипт ловит регрессии в токенах/CSS-примитивах
// ui/ до рантайма: контраст ключевых пар токенов (WCAG AA) + мин. тач-высоту/ширину общих
// интерактивных примитивов ui.css. Быстрый, без headless-браузера, гоняется в `pnpm test`-контуре.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const srcDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src");

function fail(message) {
  console.error(`✗ ${message}`);
  process.exitCode = 1;
}

function ok(message) {
  console.warn(`✓ ${message}`);
}

// --- Контраст (WCAG 2 relative luminance / contrast ratio) ---
function hexToRgb(hex) {
  const clean = hex.replace("#", "");
  const full = clean.length === 3 ? clean.split("").map((c) => c + c).join("") : clean;
  const n = parseInt(full, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function channelLuminance(c) {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

function relativeLuminance({ r, g, b }) {
  return 0.2126 * channelLuminance(r) + 0.7152 * channelLuminance(g) + 0.0722 * channelLuminance(b);
}

function contrastRatio(hexA, hexB) {
  const lA = relativeLuminance(hexToRgb(hexA));
  const lB = relativeLuminance(hexToRgb(hexB));
  const [lighter, darker] = lA >= lB ? [lA, lB] : [lB, lA];
  return (lighter + 0.05) / (darker + 0.05);
}

// Ключевые пары токенов из theme/tokens.css (--ref-* значения продублированы здесь буквально,
// т.к. это статическая CSS-переменная — при правке палитры MF-729-подобная задача обязана
// обновить и это число, тест упадёт и напомнит). Каждая запись — [название, fg, bg, минимум].
const CONTRAST_PAIRS = [
  // Тёмная тема: основной текст на фоне.
  ["dark: --text on --bg", "#eef5f2", "#0a1512", 4.5],
  ["dark: --text-dim on --bg", "#8ba69c", "#0a1512", 4.5],
  ["dark: --accent-contrast on --accent (кнопка primary)", "#04120d", "#34d399", 4.5],
  // Светлая тема: основной текст на фоне.
  ["light: --text on --bg", "#2b2620", "#f6f1e7", 4.5],
  ["light: --text-dim on --bg", "#6b6153", "#f6f1e7", 4.5],
  ["light: --accent-contrast on --accent (кнопка primary)", "#f4fff6", "#14803a", 4.5],
  // «Геройская инверсия» (printerface.css .faceHeroPanel[data-active]): тёмный текст на мятном
  // градиенте — обе стоп-точки градиента, большой текст (>=24px) требует минимум 3:1.
  ["hero: тёмный текст на мятном градиенте (тёмный край)", "#0a1512", "#68e2a2", 3],
  ["hero: тёмный текст на мятном градиенте (светлый край)", "#0a1512", "#9eeec3", 3],
  // `StatusPill tone="dim"` (park/парк, printers/каталог) — реально отрендеренная пилюля: текст
  // --text-dim поверх составленного фона пилюли (--surface × 45% поверх --bg), не сырой --bg
  // (MF-1869, docs/audits/park.pilot.a11y.mf1588.md — flat opacity на блок раньше давал <3:1).
  ["dark: StatusPill dim текст на составленном фоне пилюли", "#8ba69c", "#0e1c18", 4.5],
  ["light: StatusPill dim текст на составленном фоне пилюли", "#6b6153", "#faf6ef", 4.5],
];

function checkContrast() {
  for (const [label, fg, bg, min] of CONTRAST_PAIRS) {
    const ratio = contrastRatio(fg, bg);
    if (ratio < min) {
      fail(`контраст ${label}: ${ratio.toFixed(2)}:1 < ${min}:1 (fg=${fg} bg=${bg})`);
    } else {
      ok(`контраст ${label}: ${ratio.toFixed(2)}:1 >= ${min}:1`);
    }
  }
}

// --- Тач-таргеты: общие интерактивные примитивы ui.css обязаны декларировать доступную
// pointer-область >=48px (--touch-target-min, docs/design/layout.md § «Тач/киоск») напрямую,
// через компонентный токен или прозрачный ::after hit-area. Последний вариант сохраняет
// точные Figma-размеры компактных controls (42/36px), не сжимая фактическую цель. Исключения —
// точечные декоративные элементы внутри уже тач-соответствующего родителя.
const TOUCH_TOKENS_48PX = new Set([
  "var(--touch-target-min)",
  "var(--button-height)",
  "var(--icon-button-size)",
  "var(--input-height)",
]);

// Класс -> причина, почему у него нет собственного min-height/min-width >=48px (визуальный
// элемент меньше, но кликабельная область — родитель/паддинг уже гарантирует инвариант).
const TOUCH_EXCEPTIONS = new Set([
  ".uiIconButtonBadge", // счётчик-бейдж поверх .uiIconButton, не самостоятельный таргет
  ".uiStatusDot", // индикатор внутри .uiStatusPill/StatusDot standalone (не тач-таргет)
  ".uiReasonPanelDot",
  ".uiChecklistMark", // маркер внутри .uiChecklistItem (>=48px строка)
  ".uiSwitchTrack", // визуальный трек 46x28 внутри .uiSwitch (48x48 кликабельная кнопка)
  ".uiSwitchKnob",
  ".uiAgentBadge", // неинтерактивный бейдж авторства
  ".uiSegmentToggleFill", // decorative sliding fill, aria-hidden
  ".uiSegmentToggleOption", // 40px высота внутри 48px пилюли-контейнера (padding 4px сверху/снизу)
]);

// Классы, которые обязаны быть проверены (интерактивные примитивы ui.css: button/link/tap
// target/chip/icon-button). Список сверяется с исходником — если класс исчезнет/переименуется,
// тест не должен молча перестать его проверять.
const REQUIRED_TOUCH_CLASSES = [
  ".uiButton",
  ".uiActionCard",
  ".uiIconButton",
  ".uiChip",
  ".uiPopoverItem",
  ".uiStatTile",
  ".uiVoteCompact",
  ".uiVoteLargeBtn",
  ".uiVoteInlineBtn",
  ".uiChecklistItem",
  ".uiCoachmarkOk",
  ".uiSwitch",
  ".uiReasonPanelLink",
];

function extractRules(cssRaw) {
  // Очень простой парсер: селектор { ...decls... } — CSS в ui.css плоский (без вложенности,
  // кроме @media), достаточно для min-height/min-width извлечения по имени класса.
  // Комментарии /* ... */ вырезаем заранее — иначе селектор, которому предшествует блок
  // комментария без своих {}, склеивается с текстом комментария и перестаёт startsWith()'иться.
  const css = cssRaw.replace(/\/\*[\s\S]*?\*\//g, "");
  const rules = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(css))) {
    rules.push({ selector: m[1].trim(), body: m[2] });
  }
  return rules;
}

async function checkTouchTargets() {
  const cssPath = path.join(srcDir, "ui", "ui.css");
  const css = await readFile(cssPath, "utf8");
  const rules = extractRules(css);

  function hasExpandedHitArea(cls) {
    const pseudoSelector = `${cls}::after`;
    return rules.some((rule) => {
      const selectors = rule.selector.split(",").map((selector) => selector.trim());
      if (!selectors.includes(pseudoSelector)) return false;
      const declarations = rule.body
        .split(";")
        .map((declaration) => declaration.trim())
        .filter(Boolean);
      return (
        declarations.includes("width: max(100%, var(--touch-target-min))") &&
        declarations.includes("height: max(100%, var(--touch-target-min))")
      );
    });
  }

  for (const cls of REQUIRED_TOUCH_CLASSES) {
    if (TOUCH_EXCEPTIONS.has(cls)) continue;
    const matching = rules.filter((r) => r.selector.split(",").some((s) => s.trim().startsWith(cls)));
    if (matching.length === 0) {
      fail(`тач-таргет ${cls}: класс не найден в ui/ui.css (проверь REQUIRED_TOUCH_CLASSES)`);
      continue;
    }
    const declared = matching
      .flatMap((r) => r.body.split(";"))
      .map((d) => d.trim())
      .filter(Boolean);

    const heightDecl = declared.find((d) => /^(min-height|height)\s*:/.test(d));
    const widthDecl = declared.find((d) => /^(min-width|width)\s*:/.test(d));

    function declaresAtLeast48(decl) {
      if (!decl) return false;
      const value = decl.split(":")[1].trim();
      if (TOUCH_TOKENS_48PX.has(value)) return true;
      const pxMatch = value.match(/^(\d+(?:\.\d+)?)px$/);
      if (pxMatch) return Number(pxMatch[1]) >= 48;
      // clamp(min, preferred, max) — берём минимум как гарантированную нижнюю границу.
      const clampMatch = value.match(/^clamp\(\s*(\d+(?:\.\d+)?)px/);
      if (clampMatch) return Number(clampMatch[1]) >= 48;
      return false;
    }

    if (declaresAtLeast48(heightDecl) || declaresAtLeast48(widthDecl) || hasExpandedHitArea(cls)) {
      ok(`тач-таргет ${cls}: >=48px визуально или через прозрачную hit-area`);
    } else {
      fail(
        `тач-таргет ${cls}: не найдено min-height/min-width>=48px (или --touch-target-min и т.п.) — ` +
          `добавь исключение в TOUCH_EXCEPTIONS с обоснованием, либо поправь CSS`,
      );
    }
  }
}

async function checkUiContrastDeclarations() {
  const cssPath = path.join(srcDir, "ui", "ui.css");
  const css = await readFile(cssPath, "utf8");
  const rules = extractRules(css);

  const requiredRules = [
    [
      '.uiActionCard[data-variant="primary"] .uiActionCardSub',
      "opacity: 1",
      "primary ActionCard подпись не должна терять контраст из-за opacity",
    ],
    [
      '.uiEmptyState .uiButton[data-variant="primary"]',
      "color: var(--accent-contrast)",
      "primary-действие EmptyState должно явно сохранять контраст",
    ],
    [
      '.uiStatusPill[data-tone="dim"]',
      "color: var(--text-dim)",
      "dim-тон StatusPill не должен терять контраст текста через flat opacity на блок (MF-1869)",
    ],
  ];

  for (const [selector, declaration, label] of requiredRules) {
    const found = rules.some((rule) =>
      rule.selector
        .split(",")
        .map((part) => part.trim())
        .includes(selector) &&
      rule.body
        .split(";")
        .map((part) => part.trim())
        .includes(declaration),
    );
    if (found) {
      ok(`контраст: ${label}`);
    } else {
      fail(`контраст: ${label} — не найдено ${selector} { ${declaration}; }`);
    }
  }
}

async function main() {
  checkContrast();
  await checkTouchTargets();
  await checkUiContrastDeclarations();
  if (process.exitCode) {
    console.error("\na11ycheck провален — см. ✗ выше.");
    process.exit(1);
  }
  console.warn("\na11ycheck зелёный.");
}

await main();
