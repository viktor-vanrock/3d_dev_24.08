import type { JSX } from "react";
import { useInteractionSound } from "@platform/sound";
import type { Section } from "./types.ts";
import { NAV_ITEMS, navItemEventName } from "./navitems.ts";
import { trackActivation } from "@shared/lib";
import "./bottomtabbar.css";

/*
  Bottom-tab — корневой навигатор на тач-ширинах (docs/design/touch.nav.md §1, MF-433 Фаза 2,
  MF-851/MF-2051). Читает NAV_ITEMS как есть — количество/состав пунктов не хардкодим:
  рендер — options.map, без литерального массива табов. Иконка на пункт — по ключу `section`
  (SECTION_ICON — Record для разделов NAV_ITEMS, TS проверяет исчерпанность: реестр расширит
  union — здесь будет ошибка компиляции, пока новому пункту не дали иконку — это и есть «не
  изобретай иконку сам» из спеки, только на уровне компилятора). Звук/переход — та же пара
  tick(сразу)+nav(+40ms), что пилюля в шапке (homeheader.tsx).
*/
export function BottomTabBar({
  section,
  activeSection,
  onSectionChange,
}: {
  section: Section;
  activeSection?: Section | null;
  onSectionChange: (section: Section) => void;
}) {
  const sound = useInteractionSound();
  const selectedSection = activeSection === undefined ? section : activeSection;

  function handleTap(next: GlobalSection) {
    const item = navItemEventName(next);
    if (item) trackActivation("nav_item_click", { item });
    if (next === section && selectedSection === section) return;
    const fromIndex = NAV_ITEMS.findIndex((item) => item.section === section);
    const toIndex = NAV_ITEMS.findIndex((item) => item.section === next);
    const direction = toIndex >= fromIndex ? "fwd" : "back";
    // tick уже сыграл на onPointerDown (тактильная реакция на нажатие) — здесь только nav,
    // иначе на смене раздела звучит tick+tick+nav вместо tick+nav (touch.nav.md §6).
    onSectionChange(next);
    setTimeout(() => sound.nav(direction), 40);
  }

  return (
    <nav className="bottomTabBar" aria-label="Разделы">
      {NAV_ITEMS.map((item) => {
        const active = item.section === selectedSection;
        const Icon = SECTION_ICON[item.section];
        return (
          <button
            key={item.section}
            type="button"
            className="bottomTabItem pressable"
            aria-current={active ? "page" : undefined}
            data-active={active || undefined}
            onPointerDown={() => sound.tick()}
            onClick={() => handleTap(item.section)}
          >
            <span className="bottomTabIconWrap">
              <Icon />
            </span>
            <span className="bottomTabLabel">{item.label}</span>
          </button>
        );
      })}
    </nav>
  );
}

type GlobalSection = (typeof NAV_ITEMS)[number]["section"];

const SECTION_ICON: Record<GlobalSection, () => JSX.Element> = {
  home: HouseIcon,
  feed: NewsIcon,
  market: ProjectsGridIcon,
  printers: PrinterIcon,
  materials: SpoolIcon,
};

function HouseIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M4 11.5 12 4l8 7.5M6 9.8V20h5v-5.5h2V20h5V9.8"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ProjectsGridIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="4" y="4" width="7" height="7" rx="1.4" stroke="currentColor" strokeWidth="2" />
      <rect x="13" y="4" width="7" height="7" rx="1.4" stroke="currentColor" strokeWidth="2" />
      <rect x="4" y="13" width="7" height="7" rx="1.4" stroke="currentColor" strokeWidth="2" />
      <rect x="13" y="13" width="7" height="7" rx="1.4" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}

// Лента/газета (header-capsule.md § «Закреплённая центральная навигация») — не колокол, тот
// уже занят уведомлениями капсулы (коллизия смысла).
function NewsIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M4 5h13a2 2 0 0 1 2 2v11a1.5 1.5 0 0 1-1.5 1.5H6a2 2 0 0 1-2-2V5Zm0 0a2 2 0 0 0-2 2v10a1.5 1.5 0 0 0 1.5 1.5"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M8 9h8M8 12.5h8M8 16h5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

// Тот же глиф, что бейдж «Принтер» (docs/design/community.md §7.1, CommunityKindBadge
// kind='machine') — один предмет, один глиф, дублируем разметку (не второй общий файл иконок,
// тот же приём, что искра генерации раньше делила home.tsx/bottomtabbar.tsx).
function PrinterIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M6 8V4h12v4M6 8H4a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2m12-8h2a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-2M6 8h12M6 15h12v5H6v-5Z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M8 11h1" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

// Катушка — текущая точка входа раздела «Материалы»: сегодня ведёт на филаменты, позднее
// тот же раздел расширится смолами, листовыми материалами и заготовками без смены IA.
function SpoolIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="8" stroke="currentColor" strokeWidth="2" />
      <circle cx="12" cy="12" r="2.5" stroke="currentColor" strokeWidth="2" />
      <path d="M12 4c2.8 2.2 4.3 5 4.3 8s-1.5 5.8-4.3 8M7 18.2h10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}
