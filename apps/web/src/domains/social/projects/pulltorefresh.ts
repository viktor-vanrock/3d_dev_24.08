import { useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { useInteractionSound } from "@platform/sound";
import { useIsTouchNavViewport } from "@platform/theme";

/*
  Pull-to-refresh на «Проектах» (docs/design/touch.nav.md §3, MF-433 Фаза 2). Скролл-контейнер —
  окно (window/document, там нет внутреннего overflow-контейнера) — триггер: scrollY===0 в момент
  начала жеста, тот же rubber-band приём, что §2 (свайп разделов, navswipe.ts): протяжка следует
  за пальцем 1:1 с сопротивлением, порог даёт визуальный+звуковой сигнал, отпускание запускает
  onRefresh().
*/

const AXIS_LOCK_PX = 10;
const THRESHOLD_PX = 64;
const RUBBER_LIMIT_PX = 120;
const SUCCESS_HOLD_MS = 360; // ~ --dur-callout (вспышка), затем fade-up на --dur-nav (CSS)
const FIXED_LOADING_PX = 56;

export type PullToRefreshPhase = "idle" | "pulling" | "ready" | "loading" | "success";

export interface PullToRefresh {
  phase: PullToRefreshPhase;
  distance: number;
  onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerMove: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerUp: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerCancel: (event: ReactPointerEvent<HTMLElement>) => void;
}

interface DragStart {
  x: number;
  y: number;
  pointerId: number;
  axis: "x" | "y" | null;
}

export function usePullToRefresh(onRefresh: () => Promise<void>): PullToRefresh {
  const sound = useInteractionSound();
  const narrow = useIsTouchNavViewport();
  const [phase, setPhase] = useState<PullToRefreshPhase>("idle");
  const [distance, setDistance] = useState(0);
  const startRef = useRef<DragStart | null>(null);
  // Звук порога — один раз за жест, не на каждый move-тик после пересечения.
  const crossedRef = useRef(false);
  // Зеркало phase в ref — endDrag может прийти в той же синхронной пачке событий, что решающий
  // move (быстрый флик/тест), до того, как React перерендерит компонент с новым phase из
  // замыкания; ref всегда актуален независимо от того, случился ли ре-рендер (см. тот же приём
  // и его обоснование в navswipe.ts — start.axis вместо React-state).
  const phaseRef = useRef<PullToRefreshPhase>("idle");
  function updatePhase(next: PullToRefreshPhase) {
    phaseRef.current = next;
    setPhase(next);
  }

  function onPointerDown(event: ReactPointerEvent<HTMLElement>) {
    if (!narrow || phaseRef.current === "loading" || phaseRef.current === "success") return;
    if (window.scrollY !== 0) return;
    startRef.current = { x: event.clientX, y: event.clientY, pointerId: event.pointerId, axis: null };
    crossedRef.current = false;
  }

  function onPointerMove(event: ReactPointerEvent<HTMLElement>) {
    const start = startRef.current;
    if (!start || start.pointerId !== event.pointerId) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (start.axis === null) {
      if (Math.abs(dx) < AXIS_LOCK_PX && Math.abs(dy) < AXIS_LOCK_PX) return;
      start.axis = Math.abs(dy) > Math.abs(dx) ? "y" : "x";
      // Горизонтальный жест (нав-свайп) или протяжка вверх (обычный скролл) — не наш, отдаём.
      if (start.axis !== "y" || dy <= 0) {
        startRef.current = null;
        return;
      }
      event.currentTarget.setPointerCapture(event.pointerId);
    }
    if (start.axis !== "y") return;
    const raw = Math.max(0, dy);
    const resisted = raw / (1 + raw / RUBBER_LIMIT_PX);
    setDistance(resisted);
    const next: PullToRefreshPhase = resisted >= THRESHOLD_PX ? "ready" : "pulling";
    updatePhase(next);
    if (next === "ready" && !crossedRef.current) {
      crossedRef.current = true;
      sound.toggle();
    } else if (next === "pulling") {
      crossedRef.current = false;
    }
  }

  function endDrag(event: ReactPointerEvent<HTMLElement>) {
    const start = startRef.current;
    if (!start || start.pointerId !== event.pointerId || start.axis !== "y") {
      startRef.current = null;
      return;
    }
    startRef.current = null;
    if (phaseRef.current !== "ready") {
      // Отпустил до порога — мгновенный откат, ничего не грузится (§3 спеки).
      updatePhase("idle");
      setDistance(0);
      return;
    }
    updatePhase("loading");
    setDistance(FIXED_LOADING_PX);
    void onRefresh().then(
      () => {
        updatePhase("success");
        // overlay/sound.ts (severity="success") не параметризован громкостью per-call — берём
        // tick вместо полноценного success, как явно допускает touch.nav.md §6.
        sound.tick();
        setTimeout(() => {
          updatePhase("idle");
          setDistance(0);
        }, SUCCESS_HOLD_MS);
      },
      () => {
        updatePhase("idle");
        setDistance(0);
      },
    );
  }

  return { phase, distance, onPointerDown, onPointerMove, onPointerUp: endDrag, onPointerCancel: endDrag };
}
