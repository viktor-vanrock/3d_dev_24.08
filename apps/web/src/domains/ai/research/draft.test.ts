import { beforeEach, describe, expect, it } from "vitest";
import { clearResearchDraft, DRAFT_STORAGE_KEY, isFormEmpty, loadResearchDraft, saveResearchDraft } from "./draft.ts";
import { emptyFormState } from "./formstate.ts";

beforeEach(() => {
  localStorage.clear();
});

describe("isFormEmpty", () => {
  it("пустые brand/model → пусто", () => {
    expect(isFormEmpty(emptyFormState())).toBe(true);
  });

  it("brand из пробелов — тоже пусто (trim)", () => {
    expect(isFormEmpty({ ...emptyFormState(), brand: "   " })).toBe(true);
  });

  it("есть brand → не пусто", () => {
    expect(isFormEmpty({ ...emptyFormState(), brand: "Creality" })).toBe(false);
  });
});

describe("saveResearchDraft / loadResearchDraft / clearResearchDraft (§2.8, один слот черновика)", () => {
  it("пустая форма не сохраняется вовсе", () => {
    saveResearchDraft(emptyFormState());
    expect(localStorage.getItem(DRAFT_STORAGE_KEY)).toBeNull();
  });

  it("непустой черновик читается обратно для того же slug", () => {
    const state = { ...emptyFormState(), brand: "Creality", model: "K1 Max" };
    saveResearchDraft(state);
    expect(loadResearchDraft("creality.k1-max")).toEqual(state);
  });

  it("черновик другой карточки НЕ протекает на чужой slug (изоляция между карточками)", () => {
    const state = { ...emptyFormState(), brand: "Creality", model: "K1 Max" };
    saveResearchDraft(state);
    expect(loadResearchDraft("bambu.x1c")).toBeNull();
  });

  it("targetSlug='' (/research/new до ввода) отдаёт любой сохранённый черновик", () => {
    const state = { ...emptyFormState(), brand: "Creality", model: "K1 Max" };
    saveResearchDraft(state);
    expect(loadResearchDraft("")).toEqual(state);
  });

  it("нет черновика в сторадже → null", () => {
    expect(loadResearchDraft("creality.k1-max")).toBeNull();
  });

  it("clearResearchDraft стирает сохранённое", () => {
    saveResearchDraft({ ...emptyFormState(), brand: "Creality", model: "K1 Max" });
    clearResearchDraft();
    expect(loadResearchDraft("creality.k1-max")).toBeNull();
  });

  it("битый JSON в сторадже — не роняет, читается как null", () => {
    localStorage.setItem(DRAFT_STORAGE_KEY, "{not json");
    expect(loadResearchDraft("creality.k1-max")).toBeNull();
  });
});
