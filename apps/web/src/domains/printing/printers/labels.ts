// eslint-disable-next-line boundaries/element-types -- легатное междоменное ребро (Этап 9): printing→ai KINEMATICS_OPTIONS, развязка отложена до pages/DI. См. MIGRATION.md.
import { KINEMATICS_OPTIONS } from "@domains/ai";
import type { CapabilityKey, ConnectivityKey, PrinterStatusKey, SupportLevelKey } from "./facets.ts";
import type { ReleaseStatus } from "./releasefixtures.ts";
import type { StatusLevel, StatusTone } from "@shared/ui";

// Человеко-читаемые подписи фасетов/чипов каталога (docs/design/printers.catalog.md) — общий
// словарь, чтобы плитка (printertile.tsx), сайдбар (printersscreen.tsx) и карточка
// (printerdetailscreen.tsx) не расходились в формулировках.

export const STATUS_LABEL: Record<PrinterStatusKey, string> = {
  announced: "Анонсирован",
  shipping: "Выпускается",
  eol: "Снят с производства",
  rumored: "Слухи",
};

// dim для фаз жизни, обычная заливка только для «выпускается» (§3: «показывается только если
// статус не обычная жизнь» — shipping без пометки на плитке не рисуется вовсе).
export const STATUS_TONE: Record<PrinterStatusKey, StatusTone> = {
  announced: "dim",
  shipping: "ok",
  eol: "dim",
  rumored: "dim",
};

// Бейджи support_level (docs/design/printer.face.md §1) — единственный источник словаря
// тонов/текста для list/managed/custom, каталог/парк/мастер на него ссылаются, второй набор
// не заводим. `custom` рисуется через `FlagshipBadge` (ui/ui.tsx), не `StatusPill` — здесь
// только текст и tone/level для двух обычных пилюль.
export const SUPPORT_LEVEL_LABEL: Record<SupportLevelKey, string> = {
  list: "В каталоге",
  managed: "Управляется",
  custom: "Полный портал",
};

export const SUPPORT_LEVEL_TONE: Record<SupportLevelKey, StatusTone> = {
  list: "dim",
  managed: "ok",
  custom: "ok",
};

export const SUPPORT_LEVEL_LEVEL: Record<SupportLevelKey, StatusLevel | undefined> = {
  list: undefined,
  managed: 2,
  custom: undefined,
};

export type SupportPresentation = SupportLevelKey | "custom-soon" | "unknown";

// Уровень модели приходит только из явного catalog-контракта. Отсутствующее или незнакомое
// значение не поднимаем до managed/custom: интерфейс должен объяснить неопределённость, а не
// угадать её по link_source, названию модели или старому snapshot.
export function supportLevelOf(value: unknown): SupportLevelKey | null {
  return value === "list" || value === "managed" || value === "custom" ? value : null;
}

export function supportPresentationFor(value: unknown, firmwareReady: unknown): SupportPresentation {
  const level = supportLevelOf(value);
  if (!level) return "unknown";
  if (level === "custom" && firmwareReady !== true) return "custom-soon";
  return level;
}

export const CAPABILITY_LABEL: Record<CapabilityKey, string> = {
  ams: "AMS",
  laser: "Лазер/ЧПУ-голова",
  enclosed: "Закрытая камера",
  auto_leveling: "Автокалибровка",
  hardened: "Закалённый хотэнд",
  moonraker: "Moonraker",
  lan_mode: "LAN-режим",
};

export const KINEMATICS_LABEL: Record<string, string> = Object.fromEntries(
  KINEMATICS_OPTIONS.map((option) => [option.value, option.label]),
);

export const CONNECTIVITY_LABEL: Record<ConnectivityKey, string> = {
  wifi: "Wi-Fi",
  ethernet: "Ethernet",
  camera: "Камера",
};

// Статус события календаря новинок (docs/design/printers.md §1) — не тот же словарь, что
// STATUS_LABEL/STATUS_TONE выше (жизненный статус модели каталога): `preorder` — состояние
// события, которого нет в жизненном цикле модели (announced/shipping/eol/rumored). Тот же
// компонент `StatusPill`, что и каталог — переиспользуем токен пилюли (§1: «не заводим второй
// словарь цветов для того же смысла»), просто с адаптированным набором ключей под три состояния
// релиза. `shipping` — единственный «горячий» полностью залитый тон (level 2), остальные — dim.
export const RELEASE_STATUS_LABEL: Record<ReleaseStatus, string> = {
  announced: "Анонсирован",
  preorder: "Предзаказ",
  shipping: "Выпускается",
};

export const RELEASE_STATUS_TONE: Record<ReleaseStatus, StatusTone> = {
  announced: "dim",
  preorder: "dim",
  shipping: "ok",
};

export const RELEASE_STATUS_LEVEL: Record<ReleaseStatus, StatusLevel | undefined> = {
  announced: undefined,
  preorder: undefined,
  shipping: 2,
};
