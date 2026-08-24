import { useEffect, useState } from "react";

// Граница «это мобильный тач-режим» (touch.nav.md §1) — та же, на которой уже ужимается капсула
// шапки (home.css .homeCapsuleTier). Общий источник, чтобы bottom-tab/свайп/pull-to-refresh не
// плодили свою копию matchMedia (см. theme/reducedmotion.ts — тот же приём для reduced-motion).

const QUERY = "(max-width: 640px)";

export function isTouchNavViewportNow(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia(QUERY).matches;
}

export function useIsTouchNavViewport(): boolean {
  const [narrow, setNarrow] = useState(isTouchNavViewportNow);
  useEffect(() => {
    const mq = window.matchMedia(QUERY);
    const onChange = () => setNarrow(isTouchNavViewportNow());
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return narrow;
}
