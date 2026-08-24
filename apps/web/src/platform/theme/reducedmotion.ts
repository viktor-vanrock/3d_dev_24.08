import { useEffect, useState } from "react";

// Общий источник правды для prefers-reduced-motion (motion.md: «уважает reduced-motion/Save-Data
// везде») — раньше matchMedia дублировался локально в projects/hero.tsx; выносим сюда, чтобы
// новые места (навигация Дом⇄Проекты, карусель) не плодили свою копию.

const QUERY = "(prefers-reduced-motion: reduce)";

export function prefersReducedMotionNow(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  // Save-Data (Data Saver в браузере) — тот же сигнал «поменьше движения», см. motion.md токены.
  const saveData = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData;
  return window.matchMedia(QUERY).matches || Boolean(saveData);
}

export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(prefersReducedMotionNow);
  useEffect(() => {
    const mq = window.matchMedia(QUERY);
    const onChange = () => setReduced(prefersReducedMotionNow());
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return reduced;
}
