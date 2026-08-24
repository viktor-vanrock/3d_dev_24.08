import { useLayoutEffect, useRef, useState, type ReactNode } from "react";

/*
  Сегмент-тумблер (эпик MF-40, структура под MF-601 §2/§7 motion.md): единый компонент для
  пилюли «Дом»⇄«Проекты» (homeheader.tsx) и сортировки «Новые»/«Популярные» (projectspage.tsx) —
  раньше это были две независимые разметки без общего DOM-якоря для скользящей заливки.
  Заливка (.uiSegmentToggleFill) — реальный элемент, один на группу: координаты активной кнопки
  передаются через transform/width. Так активное состояние остаётся пилюлей без галочки, а Motion
  получает общий DOM-якорь для скользящего перехода между табами.

  Active item следует Figma: сплошная --accent-заливка и контрастный текст. Пилюлю можно зажать
  и перетащить на другой таб — тот же приём drag, что у ThemeToggle (theme/themetoggle.tsx):
  pointer capture на самой обводке, живой предпросмотр позиции без немедленного onChange
  (навигация — дорогая операция, дёргать её на каждый пиксель драга нельзя), коммит и звук —
  один раз на отпускании.
*/
export interface SegmentOption<T extends string> {
  value: T;
  label: ReactNode;
}

export function SegmentToggle<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  className,
  onPress,
  onPressEnd,
}: {
  options: SegmentOption<T>[];
  value: T | null;
  onChange: (value: T) => void;
  ariaLabel?: string;
  className?: string;
  // Pass-through пойнтер-хуки (см. Button/Chip/ActionCard/IconButton в ui.tsx) — Motion/Sound
  // вешают свою логику на press/release, не переписывая разметку.
  onPress?: (value: T) => void;
  onPressEnd?: (value: T) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const fillRef = useRef<HTMLSpanElement>(null);
  const optionRefs = useRef<Map<T, HTMLButtonElement>>(new Map());
  const [fill, setFill] = useState<{ left: number; width: number } | null>(null);
  // Живой предпросмотр во время драга — НЕ то же самое, что value: value меняется (и реально
  // навигирует) только на отпускании над другим табом, dragValue двигает только обводку.
  const [dragValue, setDragValue] = useState<T | null>(null);
  const dragState = useRef<{ pointerId: number; moved: boolean } | null>(null);

  const displayValue = dragValue ?? value;

  useLayoutEffect(() => {
    const container = containerRef.current;
    const active = displayValue ? optionRefs.current.get(displayValue) : null;
    if (!container || !active) {
      setFill(null);
      return;
    }
    const containerRect = container.getBoundingClientRect();
    const activeRect = active.getBoundingClientRect();
    setFill({ left: activeRect.left - containerRect.left, width: activeRect.width });
  }, [displayValue, options.length]);

  // Таб под координатой X — при выходе за пределы ряда прилипает к крайнему, а не пропадает
  // (перетащили обводку дальше первого/последнего таба — она всё равно должна на чём-то стоять).
  function optionAt(clientX: number): T | null {
    let best: { value: T; distance: number } | null = null;
    for (const [val, el] of optionRefs.current) {
      const rect = el.getBoundingClientRect();
      if (clientX >= rect.left && clientX <= rect.right) return val;
      const distance = clientX < rect.left ? rect.left - clientX : clientX - rect.right;
      if (!best || distance < best.distance) best = { value: val, distance };
    }
    return best?.value ?? null;
  }

  function onFillPointerDown(event: React.PointerEvent<HTMLSpanElement>) {
    try {
      fillRef.current?.setPointerCapture(event.pointerId);
    } catch {
      // capture недоступен (синтетическое событие/старый браузер) — драг всё равно работает
    }
    dragState.current = { pointerId: event.pointerId, moved: false };
  }

  function onFillPointerMove(event: React.PointerEvent<HTMLSpanElement>) {
    if (!dragState.current || dragState.current.pointerId !== event.pointerId) return;
    dragState.current.moved = true;
    const hovered = optionAt(event.clientX);
    if (hovered && hovered !== (dragValue ?? value)) setDragValue(hovered);
  }

  function onFillPointerUp(event: React.PointerEvent<HTMLSpanElement>) {
    if (!dragState.current || dragState.current.pointerId !== event.pointerId) return;
    const moved = dragState.current.moved;
    const target = dragValue;
    dragState.current = null;
    setDragValue(null);
    // Звук+коммит — один раз здесь, на отпускании (тот же принцип, что ThemeToggle: во время
    // самого движения тихо). Простой тап по обводке без сдвига (moved=false) ничего не меняет —
    // обводка и так стоит на активном табе.
    if (moved && target && target !== value) {
      onChange(target);
      onPress?.(target);
    }
  }

  return (
    <div
      className={`uiSegmentToggle${className ? ` ${className}` : ""}`}
      role="tablist"
      aria-label={ariaLabel}
      ref={containerRef}
    >
      {fill ? (
        <span
          ref={fillRef}
          className="uiSegmentToggleFill"
          aria-hidden="true"
          data-dragging={dragValue !== null || undefined}
          style={{ transform: `translateX(${fill.left}px)`, width: `${fill.width}px` }}
          onPointerDown={onFillPointerDown}
          onPointerMove={onFillPointerMove}
          onPointerUp={onFillPointerUp}
          onPointerCancel={onFillPointerUp}
        />
      ) : null}
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          ref={(node) => {
            if (node) optionRefs.current.set(option.value, node);
            else optionRefs.current.delete(option.value);
          }}
          role="tab"
          aria-selected={option.value === value}
          className="uiSegmentToggleOption pressable"
          data-selected={option.value === value || undefined}
          data-active={option.value === displayValue || undefined}
          onClick={() => onChange(option.value)}
          onPointerDown={() => onPress?.(option.value)}
          onPointerUp={() => onPressEnd?.(option.value)}
          onPointerCancel={() => onPressEnd?.(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
