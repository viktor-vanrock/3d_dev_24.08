import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useCatalogQuery } from "./catalogstore.ts";
import { mergePublishedShowcase } from "./publishedshowcase.ts";

vi.mock("@domains/commerce/models.ts", () => ({
  listModels: vi.fn(() => new Promise(() => {})),
  listTagsWithCounts: vi.fn(() => new Promise(() => {})),
}));

afterEach(() => {
  cleanup();
  window.history.replaceState(null, "", "/project");
});

describe("useCatalogQuery", () => {
  it("добавляет опубликованный SO-ARM100 в общую галерею без дублей", () => {
    const published = mergePublishedShowcase([], { q: "", tags: [] });
    const repeated = mergePublishedShowcase(published, { q: "", tags: [] });

    expect(published[0]?.id).toBe("so-arm100");
    expect(repeated.filter((model) => model.id === "so-arm100")).toHaveLength(1);
  });

  it("учитывает поиск и фасеты для опубликованного showcase", () => {
    expect(mergePublishedShowcase([], { q: "SO ARM100", tags: [] })[0]?.id).toBe("so-arm100");
    expect(mergePublishedShowcase([], { q: "несуществующий проект", tags: [] })).toEqual([]);
    expect(mergePublishedShowcase([], { q: "", tags: ["без ams"] })[0]?.id).toBe("so-arm100");
    expect(mergePublishedShowcase([], { q: "", tags: ["sla"] })).toEqual([]);
  });

  it("читает search внешнего /market deep-link как поисковый запрос", () => {
    window.history.replaceState(null, "", "/market?search=zzzz-no-results");

    const { result } = renderHook(() => useCatalogQuery());

    expect(result.current.q).toBe("zzzz-no-results");
  });

  it("синхронизирует фильтры после browser back/forward", () => {
    window.history.replaceState(null, "", "/market?search=zzzz-no-results");
    const { result } = renderHook(() => useCatalogQuery());

    act(() => {
      // Исторически браузер уже сменил адрес до события popstate — тот же порядок, что у Back/Forward.
      window.history.pushState(null, "", "/market?q=tentacled-ps5-stand&sort=popular&tag=stand&tag=pla&fit=mine");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });

    expect(result.current.q).toBe("tentacled-ps5-stand");
    expect(result.current.sort).toBe("popular");
    expect(result.current.tags).toEqual(["stand", "pla"]);
    expect(result.current.fitMine).toBe(true);
  });

  it("популярный запрос заменяет прежний поиск и фильтры", () => {
    window.history.replaceState(null, "", "/market?q=old-query&tag=old-tag");
    const { result } = renderHook(() => useCatalogQuery());

    act(() => result.current.selectPopularTag("new-tag"));

    expect(result.current.q).toBe("");
    expect(result.current.tags).toEqual(["new-tag"]);
  });

  it("повторный выбор популярного запроса снимает его", () => {
    window.history.replaceState(null, "", "/market?tag=stand");
    const { result } = renderHook(() => useCatalogQuery());

    act(() => result.current.selectPopularTag("stand"));

    expect(result.current.tags).toEqual([]);
  });

  it("сбрасывает персональный фильтр вместе с остальными", () => {
    window.history.replaceState(null, "", "/project?fit=mine&tag=ams");
    const { result } = renderHook(() => useCatalogQuery());

    act(() => result.current.reset());

    expect(result.current.fitMine).toBe(false);
    expect(result.current.tags).toEqual([]);
  });
});
