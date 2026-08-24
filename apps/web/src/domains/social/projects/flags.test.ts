import { afterEach, describe, expect, it } from "vitest";
import { isWideProjectsEnabled } from "./flags.ts";

// Флаг новой «Проектов» (MF-512): дефолт теперь ВКЛ (Lead снял гейт после первого слайса) —
// регрессия «флаг тихо вернулся в ВЫКЛ» была бы протухшей витриной без предупреждения.

afterEach(() => {
  window.history.replaceState(null, "", "/project");
});

describe("isWideProjectsEnabled", () => {
  it("по умолчанию — включено", () => {
    expect(isWideProjectsEnabled()).toBe(true);
  });

  it("?wide=0 — принудительно выключает", () => {
    window.history.replaceState(null, "", "/project?wide=0");
    expect(isWideProjectsEnabled()).toBe(false);
  });

  it("?wide=1 — принудительно включает", () => {
    window.history.replaceState(null, "", "/project?wide=1");
    expect(isWideProjectsEnabled()).toBe(true);
  });
});
