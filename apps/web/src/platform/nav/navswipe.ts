import { useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { useInteractionSound } from "@platform/sound";
import { useIsTouchNavViewport } from "@platform/theme";
import type { Section } from "./types.ts";
import { NAV_ITEMS } from "./navitems.ts";

/*
  Свайп между разделами (docs/design/touch.nav.md §2, MF-433 Фаза 2) — второй вход к тем же
  разделам NAV_ITEMS, что таб/пилюля: тот же onSectionChange, звук идентичен завершённому тапу
  (tick+nav, §6 спеки). Механика — тот же rubber-band/tap-vs-swipe разбор, что уже даёт
  projects/hero.tsx (MF-606) для карусели: сопротивление к границе, порог ИЛИ флик по скорости,
  недотянутый свайп мгновенно откатывается (без spring-transition — как и в hero.tsx, там тоже
  инстант-снап на dragX=0, см. hero.css). Внутренние функции hero.tsx не экспортированы (карусель
  переключает слайд ВНУТРИ страницы, этот хук — раздел целиком) — общих пойнтер-примитивов между
  ними в кодовой базе нет, поэтому логика здесь отдельная, тем же приёмом.
*/

const AXIS_LOCK_PX = 10;
const SWIPE_FRACTION = 0.25;
const FLICK_VELOCITY_PX_MS = 0.5;
// Свайп «за край» реестра (первый раздел вправо / последний влево) тормозит сильнее обычного
// rubber-band — сопротивление есть, перехода нет (§2 спеки).
const EDGE_RESISTANCE_DIVISOR = 3.5;

interface DragStart {
  x: number;
  y: number;
  time: number;
  pointerId: number;
  width: number;
  axis: "x" | "y" | null;
}

export interface SectionSwipeNav {
  dragX: number;
  onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerMove: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerUp: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerCancel: (event: ReactPointerEvent<HTMLElement>) => void;
}

// excludeSelector — поддерево, которое забирает горизонтальный жест себе (hero-карусель внутри
// «Проектов» — свой tap-vs-swipe, приоритет карусели, §2 спеки «Приоритет с горизонтальными
// каруселями»).
export function useSectionSwipeNav(
  section: Section,
  onSectionChange: (section: Section) => void,
  excludeSelector = ".heroCarousel",
): SectionSwipeNav {
  const sound = useInteractionSound();
  const narrow = useIsTouchNavViewport();
  const [dragX, setDragX] = useState(0);
  const startRef = useRef<DragStart | null>(null);

  function onPointerDown(event: ReactPointerEvent<HTMLElement>) {
    if (!narrow) return;
    if (event.pointerType === "mouse" && event.button !== 0) return;
    if ((event.target as HTMLElement).closest?.(excludeSelector)) return;
    startRef.current = {
      x: event.clientX,
      y: event.clientY,
      time: event.timeStamp,
      pointerId: event.pointerId,
      width: event.currentTarget.getBoundingClientRect().width || 1,
      axis: null,
    };
  }

  function onPointerMove(event: ReactPointerEvent<HTMLElement>) {
    const start = startRef.current;
    if (!start || start.pointerId !== event.pointerId) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (start.axis === null) {
      if (Math.abs(dx) < AXIS_LOCK_PX && Math.abs(dy) < AXIS_LOCK_PX) return;
      start.axis = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
      // Вертикальная составляющая больше — это скролл ленты, не наш жест (axis-lock, §2 спеки):
      // отдаём палец браузеру, дальнейшие move этого поинтера больше не обрабатываем.
      if (start.axis !== "x") return;
      event.currentTarget.setPointerCapture(event.pointerId);
    }
    if (start.axis !== "x") return;
    const fromIndex = NAV_ITEMS.findIndex((item) => item.section === section);
    const atEdge = (dx > 0 && fromIndex <= 0) || (dx < 0 && fromIndex >= NAV_ITEMS.length - 1);
    const limit = start.width * 0.9;
    const divisor = atEdge ? limit / EDGE_RESISTANCE_DIVISOR : limit;
    setDragX(dx / (1 + Math.abs(dx) / divisor));
  }

  function endDrag(event: ReactPointerEvent<HTMLElement>) {
    const start = startRef.current;
    if (!start || start.pointerId !== event.pointerId) return;
    const dx = event.clientX - start.x;
    const elapsed = Math.max(1, event.timeStamp - start.time);
    const velocity = Math.abs(dx) / elapsed;
    // start.axis (ref, не React state) — иначе pointerup, пришедший в той же синхронной пачке
    // событий, что и решающий move (частый случай в тестах/быстром флике), читал бы устаревший
    // dragging из замыкания до того, как React успел перерендерить компонент с новым состоянием.
    const wasDragging = start.axis === "x";
    startRef.current = null;
    setDragX(0);
    if (!wasDragging) return;
    const passed = Math.abs(dx) >= start.width * SWIPE_FRACTION || velocity >= FLICK_VELOCITY_PX_MS;
    if (!passed) return;
    const fromIndex = NAV_ITEMS.findIndex((item) => item.section === section);
    if (dx < 0 && fromIndex < NAV_ITEMS.length - 1) {
      const next = NAV_ITEMS[fromIndex + 1]!.section;
      sound.tick();
      onSectionChange(next);
      setTimeout(() => sound.nav("fwd"), 40);
    } else if (dx > 0 && fromIndex > 0) {
      const next = NAV_ITEMS[fromIndex - 1]!.section;
      sound.tick();
      onSectionChange(next);
      setTimeout(() => sound.nav("back"), 40);
    }
  }

  return { dragX, onPointerDown, onPointerMove, onPointerUp: endDrag, onPointerCancel: endDrag };
}
