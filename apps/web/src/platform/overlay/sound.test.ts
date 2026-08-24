import { afterEach, describe, expect, it, vi } from "vitest";
import { playSound } from "./sound.ts";

/*
  Тесты «готово когда» MF-443 §6: mute полностью глушит звук (не создаёт AudioContext
  вовсе — не только не слышно, а и не тратим ресурс), unmuted-путь не бросает исключение
  в средах без WebAudio (happy-dom — как некоторые реальные старые браузеры/Save-Data).
*/

const original = (window as unknown as { AudioContext?: unknown }).AudioContext;

afterEach(() => {
  (window as unknown as { AudioContext?: unknown }).AudioContext = original;
});

describe("playSound", () => {
  it("muted=true — AudioContext вообще не создаётся", () => {
    const ctorSpy = vi.fn();
    (window as unknown as { AudioContext: unknown }).AudioContext = ctorSpy;
    playSound("critical", true);
    expect(ctorSpy).not.toHaveBeenCalled();
  });

  it("muted=false — не бросает исключение, даже без реализации WebAudio в среде", () => {
    expect(() => playSound("success", false)).not.toThrow();
    expect(() => playSound("warn", false)).not.toThrow();
    expect(() => playSound("push", false)).not.toThrow();
  });
});
