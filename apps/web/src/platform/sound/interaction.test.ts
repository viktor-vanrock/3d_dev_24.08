import { afterEach, describe, expect, it, vi } from "vitest";
import { playInteractionSound } from "./interaction.ts";

/*
  Тесты «готово когда» MF-615 (тот же контракт, что overlay/sound.test.ts MF-443): mute
  глушит звук БЕЗ создания AudioContext (не тратим ресурс, не только «не слышно»), unmuted-путь
  не бросает исключение ни для одного тембра, включая оба направления nav.
*/

const original = (window as unknown as { AudioContext?: unknown }).AudioContext;

afterEach(() => {
  (window as unknown as { AudioContext?: unknown }).AudioContext = original;
});

describe("playInteractionSound", () => {
  it("muted=true — AudioContext вообще не создаётся", () => {
    const ctorSpy = vi.fn();
    (window as unknown as { AudioContext: unknown }).AudioContext = ctorSpy;
    playInteractionSound("tick", true);
    playInteractionSound("cta", true);
    playInteractionSound("toggle", true);
    playInteractionSound("nav", true);
    playInteractionSound("confirm", true);
    playInteractionSound("success", true);
    playInteractionSound("error", true);
    playInteractionSound("offline", true);
    expect(ctorSpy).not.toHaveBeenCalled();
  });

  it("muted=false — не бросает исключение ни для одного тембра, даже без реализации WebAudio в среде", () => {
    expect(() => playInteractionSound("tick", false)).not.toThrow();
    expect(() => playInteractionSound("cta", false)).not.toThrow();
    expect(() => playInteractionSound("toggle", false)).not.toThrow();
    expect(() => playInteractionSound("nav", false, { direction: "fwd" })).not.toThrow();
    expect(() => playInteractionSound("nav", false, { direction: "back" })).not.toThrow();
    expect(() => playInteractionSound("confirm", false)).not.toThrow();
    expect(() => playInteractionSound("success", false)).not.toThrow();
    expect(() => playInteractionSound("error", false)).not.toThrow();
    expect(() => playInteractionSound("offline", false)).not.toThrow();
  });
});
