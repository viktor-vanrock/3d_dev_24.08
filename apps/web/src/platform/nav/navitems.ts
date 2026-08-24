import type { Section } from "./types.ts";

export interface NavItem {
  section: Section;
  label: string;
}

// Реестр верхнеуровневых разделов (docs/design/header-capsule.md § «Закреплённая центральная
// навигация», канон MF-789/MF-804): один источник для нав-табов в обоих режимах шапки, для
// bottom-tab (bottomtabbar.tsx) и свайпа (navswipe.ts) — добавление раздела не требует правок
// ни одного из потребителей сверх записи здесь. «Генерация» из реестра убрана (роут
// /generate остаётся в router.ts, вход в генератор — строка поиска Дома,
// docs/design/generation.md). MF-2051 добавляет самостоятельный раздел материалов после
// принтеров: пока он открывается на отфильтрованном каталоге филаментов, но уже не притворяется
// частью раздела оборудования.
export const NAV_ITEMS = [
  { section: "home", label: "Дом" },
  { section: "feed", label: "Новости" },
  { section: "market", label: "Проекты" },
  { section: "printers", label: "Принтеры" },
  { section: "materials", label: "Материалы" },
] as const satisfies readonly NavItem[];

// Значение для продуктовой метрики повторяет язык воронки: пункт интерфейса `market`
// в событии называется `project`. Реестр остаётся единой точкой соответствия для шапки и tabbar.
export const NAV_ITEM_EVENT_NAMES = {
  home: "home",
  feed: "feed",
  market: "project",
  printers: "printers",
  materials: "materials",
} as const;

export function navItemEventName(section: Section): (typeof NAV_ITEM_EVENT_NAMES)[keyof typeof NAV_ITEM_EVENT_NAMES] | null {
  if (!(section in NAV_ITEM_EVENT_NAMES)) return null;
  return NAV_ITEM_EVENT_NAMES[section as keyof typeof NAV_ITEM_EVENT_NAMES];
}
