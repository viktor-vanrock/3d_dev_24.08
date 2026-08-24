import { useEffect } from "react";

// Разводка фокуса пультом на Доме (home.visual.md §10, tv.10foot.md §9, MF-923) — конкретная
// раскладка одного экрана поверх общего примитива theme/inputmode.ts. Опрашивает DOM по
// стабильным классам вместо прокидывания рефов через HeroSearch/Showcase/HomeHeader (три разных
// файла) — тот же приём, что useSectionSwipeNav уже применяет к `.heroCarousel, .homeGallery`.

// Скелеты используют ту же геометрию `.homeModelTile`, но не являются интерактивными.
// Фокусируем только готовые плитки, иначе ранний `focus()` попадёт в обычный `div`,
// цикл ожидания завершится и пульт останется без активного элемента.
const TILE_SELECTOR = ".homeShowcase .homeModelTile.pressable";
const CHIP_SELECTOR = ".homeHintChip";
const INPUT_SELECTOR = ".homeGhostInput";
const SPARK_SELECTOR = ".homeSendButton";
const HEADER_FOCUS_SELECTOR = ".homeCapsule button";

function focusEl(selector: string): boolean {
  const el = document.querySelector<HTMLElement>(selector);
  if (!el) return false;
  el.focus();
  return true;
}

// Полки грузятся асинхронно (useShelves) — первая плитка появляется в DOM позже монтирования
// экрана, поэтому автофокус ждёт её коротким поллингом вместо однократной попытки в эффекте.
// Возвращает cancel() — эффект обязан звать его на анмаунт, иначе таймер переживает размонтированный
// экран (утечка между тестами: следующий render() в другом test-окружении ловит его выстрел).
function focusFirstTileWhenReady(): () => void {
  let cancelled = false;
  let timer: number | undefined;

  function attempt(attemptsLeft: number) {
    if (cancelled) return;
    const tile = document.querySelector<HTMLElement>(TILE_SELECTOR);
    if (tile) {
      tile.focus();
      return;
    }
    if (attemptsLeft <= 0) return;
    timer = window.setTimeout(() => attempt(attemptsLeft - 1), 100);
  }
  attempt(20);

  return () => {
    cancelled = true;
    if (timer !== undefined) window.clearTimeout(timer);
  };
}

function tileRow(tile: HTMLElement): number {
  return tile.offsetTop;
}

function handleTileNav(event: KeyboardEvent, tiles: HTMLElement[], index: number) {
  const tile = tiles[index];
  if (!tile) return;
  const row = tileRow(tile);
  if (event.key === "ArrowLeft") {
    const prev = index > 0 ? tiles[index - 1] : undefined;
    if (prev && tileRow(prev) === row) prev.focus();
  } else if (event.key === "ArrowRight") {
    const next = tiles[index + 1];
    if (next && tileRow(next) === row) next.focus();
  } else if (event.key === "ArrowUp") {
    let prevRowTile: HTMLElement | undefined;
    for (let i = index - 1; i >= 0; i--) {
      const candidate = tiles[i];
      if (candidate && tileRow(candidate) < row) {
        prevRowTile = candidate;
        break;
      }
    }
    if (prevRowTile) prevRowTile.focus();
    else focusEl(CHIP_SELECTOR); // первая плитка первой полки, ↑ (§10) → чипы-подсказки
  } else if (event.key === "ArrowDown") {
    let nextRowTile: HTMLElement | undefined;
    for (let i = index + 1; i < tiles.length; i++) {
      const candidate = tiles[i];
      if (candidate && tileRow(candidate) > row) {
        nextRowTile = candidate;
        break;
      }
    }
    if (nextRowTile) nextRowTile.focus();
    else focusEl(HEADER_FOCUS_SELECTOR); // последняя плитка последней полки, ↓ (§10) → меню шапки
  } else {
    return;
  }
  event.preventDefault();
}

function handleChipNav(event: KeyboardEvent, chips: HTMLElement[], index: number) {
  if (event.key === "ArrowLeft") {
    chips[index - 1]?.focus();
  } else if (event.key === "ArrowRight") {
    chips[index + 1]?.focus();
  } else if (event.key === "ArrowUp") {
    focusEl(INPUT_SELECTOR); // ↑ ещё раз (§10) → поле ввода
  } else if (event.key === "ArrowDown") {
    focusEl(TILE_SELECTOR);
  } else {
    return;
  }
  event.preventDefault();
}

function onKeyDown(event: KeyboardEvent) {
  if (!["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key)) return;
  const target = event.target as HTMLElement | null;
  if (!target) return;

  if (target.matches(TILE_SELECTOR)) {
    const tiles = Array.from(document.querySelectorAll<HTMLElement>(TILE_SELECTOR));
    handleTileNav(event, tiles, tiles.indexOf(target));
    return;
  }
  if (target.matches(CHIP_SELECTOR)) {
    const chips = Array.from(document.querySelectorAll<HTMLElement>(CHIP_SELECTOR));
    handleChipNav(event, chips, chips.indexOf(target));
    return;
  }
  if (target.matches(INPUT_SELECTOR)) {
    // Стрелки в поле — обычное перемещение каретки, кроме → на конце текста (§10 «→ с поля →
    // искра»): не перехватываем, пока курсор не в конце значения, иначе ломаем набор текста.
    const input = target as HTMLInputElement;
    if (event.key === "ArrowRight" && input.selectionStart === input.value.length && input.selectionEnd === input.value.length) {
      if (focusEl(SPARK_SELECTOR)) event.preventDefault();
    }
    return;
  }
  if (target.matches(SPARK_SELECTOR)) {
    if (event.key === "ArrowLeft") {
      if (focusEl(INPUT_SELECTOR)) event.preventDefault();
    }
  }
}

export function useHomeDpadNav(autofocusOnEntry: boolean): void {
  useEffect(() => {
    const cancelAutofocus = autofocusOnEntry ? focusFirstTileWhenReady() : undefined;
    document.addEventListener("keydown", onKeyDown);
    return () => {
      cancelAutofocus?.();
      document.removeEventListener("keydown", onKeyDown);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
