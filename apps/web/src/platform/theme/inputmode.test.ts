import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fireEvent } from "@testing-library/react";
import { initInputMode, isDpadModeNow } from "./inputmode.ts";

// tv.10foot.md §9 / MF-923: примитив «пульт/D-pad vs мышь/тач» через last-input-method.

describe("inputmode", () => {
  beforeEach(() => {
    initInputMode();
    // Модуль хранит "последний способ ввода" в module-scope состоянии, не сбрасывается между
    // тестами сам — принудительно приводим к pointer перед каждым тестом.
    fireEvent.pointerDown(document);
    delete document.documentElement.dataset.inputMode;
  });

  afterEach(() => {
    delete document.documentElement.dataset.inputMode;
  });

  it("стрелка без предшествующего pointer-события включает dpad и ставит атрибут на <html>", () => {
    expect(isDpadModeNow()).toBe(false);
    fireEvent.keyDown(document, { key: "ArrowDown" });
    expect(isDpadModeNow()).toBe(true);
    expect(document.documentElement.dataset.inputMode).toBe("dpad");
  });

  it("pointermove/pointerdown/touchstart сбрасывают режим обратно на pointer", () => {
    fireEvent.keyDown(document, { key: "ArrowUp" });
    expect(isDpadModeNow()).toBe(true);

    fireEvent.pointerMove(document);
    expect(isDpadModeNow()).toBe(false);
    expect(document.documentElement.dataset.inputMode).toBeUndefined();

    fireEvent.keyDown(document, { key: "ArrowLeft" });
    expect(isDpadModeNow()).toBe(true);
    fireEvent.pointerDown(document);
    expect(isDpadModeNow()).toBe(false);
  });

  it("Tab не включает dpad — только стрелки", () => {
    fireEvent.keyDown(document, { key: "Tab" });
    expect(isDpadModeNow()).toBe(false);
    expect(document.documentElement.dataset.inputMode).toBeUndefined();
  });
});
