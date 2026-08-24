import { useEffect, useState } from "react";

// Режим ввода «пульт/D-pad vs мышь/тач» (tv.10foot.md §9, MF-923) — «last input method» в
// рантайме, тот же паттерн, что reducedmotion.ts/deviceprofile.ts уже используют для своих осей:
// не определяем устройство, определяем ПОСЛЕДНИЙ способ ввода. Живёт на `<html data-input-mode>`,
// читается и CSS (`[data-input-mode="dpad"] :focus-visible`), и кодом (useInputMode/isDpadModeNow).

export type InputMode = "pointer" | "dpad";

const ARROW_KEYS = new Set(["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"]);

let mode: InputMode = "pointer";
const listeners = new Set<() => void>();

function setMode(next: InputMode) {
  if (mode === next) return;
  mode = next;
  if (typeof document !== "undefined") {
    if (next === "dpad") document.documentElement.dataset.inputMode = "dpad";
    else delete document.documentElement.dataset.inputMode;
  }
  listeners.forEach((listener) => listener());
}

// Только стрелки триггерят dpad (не Tab) — человек с клавиатурой у монитора не должен получить
// утяжелённый focus-ring/автофокус на плитку, задуманные для пульта/геймпада (tv.10foot.md §9).
function onKeyDown(event: KeyboardEvent) {
  if (ARROW_KEYS.has(event.key)) setMode("dpad");
}

function onPointerActivity() {
  setMode("pointer");
}

// Слушатели вешаются один раз на модуль (вызывается из main.tsx до первого рендера) — так режим
// уже актуален ДО монтирования любого экрана, включая автофокус на Доме (home.visual.md §10).
export function initInputMode(): void {
  if (typeof window === "undefined") return;
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("pointermove", onPointerActivity);
  window.addEventListener("pointerdown", onPointerActivity);
  window.addEventListener("touchstart", onPointerActivity, { passive: true });
}

export function isDpadModeNow(): boolean {
  return mode === "dpad";
}

export function useInputMode(): InputMode {
  const [current, setCurrent] = useState(mode);
  useEffect(() => {
    const listener = () => setCurrent(mode);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);
  return current;
}
