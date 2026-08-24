import { useEffect, useRef, useState } from "react";
import { useInteractionSound } from "@platform/sound";
import { useTheme } from "./theme.tsx";
import "./wisp.css";

/*
  Висп-тумблер темы: шарик-«заряд энергии» на треке солнце↔луна
  (солнце слева = светлая, луна справа = тёмная — как в исходном тумблере).
  Два способа управления (сенсор-first):
  - тап по любому месту трека — мгновенный переключатель;
  - плавное перетаскивание виспа (pointer capture, ходит за пальцем),
    отпустил — защёлкивается к ближайшей стороне (порог 0.5).
  Тап отличаем от drag по сдвигу < 5px. Визуал/анимации — wisp.css:
  висп красится токенами темы и «дышит», редкая искра, при drag разгорается.
*/

const KNOB = 24;
const PAD = 4;

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const sound = useInteractionSound();
  const trackRef = useRef<HTMLButtonElement>(null);
  const drag = useRef<{ startX: number; moved: boolean } | null>(null);
  // null = висп стоит по теме; число 0..1 = живая позиция во время drag
  const [dragX, setDragX] = useState<number | null>(null);

  const restX = theme === "dark" ? 1 : 0;
  const x = dragX ?? restX;

  // Позиция 0..1 из координаты указателя относительно трека
  function positionFrom(clientX: number): number {
    const rect = trackRef.current!.getBoundingClientRect();
    const usable = rect.width - KNOB - PAD * 2;
    return Math.min(1, Math.max(0, (clientX - rect.left - PAD - KNOB / 2) / usable));
  }

  function onPointerDown(event: React.PointerEvent<HTMLButtonElement>) {
    try {
      trackRef.current?.setPointerCapture(event.pointerId);
    } catch {
      // capture недоступен (синтетическое событие/старый браузер) — drag всё равно работает в границах трека
    }
    drag.current = { startX: event.clientX, moved: false };
  }

  function onPointerMove(event: React.PointerEvent<HTMLButtonElement>) {
    if (!drag.current) return;
    if (Math.abs(event.clientX - drag.current.startX) > 5) drag.current.moved = true;
    if (drag.current.moved) {
      const position = positionFrom(event.clientX);
      setDragX(position);
      // Живой предпросмотр: тема реально меняется, как только висп пересёк середину.
      // Глобальный транзишен цветов (tokens.css [data-theme-anim]) делает смену плавной.
      document.documentElement.dataset.themeAnim = "";
      setTheme(position > 0.5 ? "dark" : "light");
    }
  }

  function onPointerUp(event: React.PointerEvent<HTMLButtonElement>) {
    if (!drag.current) return;
    // Toggle-тембр (§2/§3 sound.md) — на смену состояния, синхронно с морфом заливки, не на
    // каждый пиксель drag; тап и отпускание drag — единственные моменты, где тема реально меняется.
    sound.toggle();
    if (drag.current.moved) {
      setTheme(positionFrom(event.clientX) > 0.5 ? "dark" : "light");
      // Хвост плавности после отпускания, затем транзишены снимаем (не тормозить UI)
      setTimeout(() => delete document.documentElement.dataset.themeAnim, 350);
    } else {
      document.documentElement.dataset.themeAnim = "";
      setTheme(theme === "dark" ? "light" : "dark"); // тап = переключить, тоже плавно
      setTimeout(() => delete document.documentElement.dataset.themeAnim, 350);
    }
    drag.current = null;
    setDragX(null);
  }

  // Страховка: потеря захвата (системные жесты) — отпускаем без смены темы
  useEffect(() => {
    const cancel = () => {
      drag.current = null;
      setDragX(null);
    };
    window.addEventListener("pointercancel", cancel);
    return () => window.removeEventListener("pointercancel", cancel);
  }, []);

  return (
    <button
      ref={trackRef}
      type="button"
      className="wispToggle"
      data-touch-target="48"
      role="switch"
      aria-checked={theme === "dark"}
      aria-label={theme === "dark" ? "Включить светлую тему" : "Включить тёмную тему"}
      data-theme={theme}
      data-dragging={dragX !== null || undefined}
      style={{ ["--wisp-x" as string]: x }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      <span className="wispPole wispPoleSun" aria-hidden="true">
        <SunIcon />
      </span>
      <span className="wispPole wispPoleMoon" aria-hidden="true">
        <MoonIcon />
      </span>
      <span className="wispKnob" aria-hidden="true">
        <span className="wispCore" />
        <span className="wispSpark" />
      </span>
    </button>
  );
}

function SunIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="4" stroke="currentColor" strokeWidth="2" />
      <path
        d="M12 2v2m0 16v2M2 12h2m16 0h2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4m0-14.2-1.4 1.4M6.3 17.7l-1.4 1.4"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M20 13.5A8 8 0 1 1 10.5 4a6.5 6.5 0 0 0 9.5 9.5Z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
    </svg>
  );
}
