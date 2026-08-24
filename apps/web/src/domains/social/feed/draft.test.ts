import { beforeEach, describe, expect, it } from "vitest";
import { clearDraft, DRAFT_STORAGE_KEY, EMPTY_DRAFT, isDraftEmpty, loadDraft, saveDraft } from "./draft.ts";

beforeEach(() => {
  localStorage.clear();
});

describe("isDraftEmpty", () => {
  it("пустой заголовок/тело/вложение → пусто", () => {
    expect(isDraftEmpty(EMPTY_DRAFT)).toBe(true);
  });

  it("заголовок из пробелов — тоже пусто (trim)", () => {
    expect(isDraftEmpty({ ...EMPTY_DRAFT, title: "   " })).toBe(true);
  });

  it("есть заголовок → не пусто", () => {
    expect(isDraftEmpty({ ...EMPTY_DRAFT, title: "Вопрос" })).toBe(false);
  });

  it("есть вложение → не пусто, даже без текста", () => {
    expect(isDraftEmpty({ ...EMPTY_DRAFT, attachment: { kind: "model", modelId: "1" } })).toBe(false);
  });
});

describe("saveDraft / loadDraft / clearDraft (§2.8 — автосейв ~2с, один черновик)", () => {
  it("сохранённый непустой черновик читается обратно", () => {
    const draft = { communityId: "c1", title: "Заголовок", body: "Текст", attachment: null };
    saveDraft(draft);
    expect(loadDraft()).toEqual(draft);
  });

  it("нет черновика в сторадже → null", () => {
    expect(loadDraft()).toBeNull();
  });

  it("сохранённый пустой черновик читается как null (нечего восстанавливать)", () => {
    saveDraft(EMPTY_DRAFT);
    expect(loadDraft()).toBeNull();
  });

  it("clearDraft стирает сохранённое", () => {
    saveDraft({ ...EMPTY_DRAFT, title: "x" });
    clearDraft();
    expect(loadDraft()).toBeNull();
  });

  it("битый JSON в сторадже — не роняет, читается как null", () => {
    localStorage.setItem(DRAFT_STORAGE_KEY, "{not json");
    expect(loadDraft()).toBeNull();
  });
});
