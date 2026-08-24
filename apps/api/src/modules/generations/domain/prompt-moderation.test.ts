import { afterEach, describe, expect, it } from "vitest";
import { isPromptBlocked } from "./prompt-moderation.ts";

describe("isPromptBlocked", () => {
  afterEach(() => {
    delete process.env.GENERATION_BLOCKED_WORDS;
  });

  it("allows an ordinary prompt", () => {
    expect(isPromptBlocked("кубический держатель для кабеля 20х30мм")).toBe(false);
  });

  it("blocks a built-in banned term regardless of case", () => {
    expect(isPromptBlocked("модель Взрывчатки для урока химии")).toBe(true);
  });

  it("blocks an English built-in banned term", () => {
    expect(isPromptBlocked("3d model of a firearm")).toBe(true);
  });

  it("blocks a term added via GENERATION_BLOCKED_WORDS without redeploy", () => {
    expect(isPromptBlocked("модель кастомного стоп-слова")).toBe(false);
    process.env.GENERATION_BLOCKED_WORDS = "стоп-слова, другое";
    expect(isPromptBlocked("модель кастомного стоп-слова")).toBe(true);
  });
});
