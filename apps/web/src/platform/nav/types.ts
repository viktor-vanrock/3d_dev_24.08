// Контракт общей web-шапки (docs/design/header-capsule.md §1): `presentation` — компактная
// шапка главного экрана; `full` — рабочая шапка во всю ширину; `back` — только возврат;
// `mixed` — возврат + полный хром. Морда принтера — отдельный device-shell (printer.face.md),
// не подменяет режим web-шапки.
export type HeaderMode = "presentation" | "full" | "back" | "mixed";

// Раздел приложения — реестр закреплённой навигации (docs/design/header-capsule.md §
// «Закреплённая центральная навигация», MF-804/MF-851/MF-2051, канон frame.md §2):
// «Генерация» — не раздел меню, вход остаётся строкой поиска Дома
// (docs/design/generation.md); экран /generate по-прежнему существует (router.ts), просто
// подсвечивает активным раздел "home" (см. app.tsx).
// "issue" сохраняется в типе для прямых роутов `/issue` и `/issue/:id`, но не входит в
// глобальный NAV_ITEMS и потому не показывается в шапке или bottom-tab.
export type Section = "home" | "feed" | "market" | "printers" | "materials" | "issue";
