import { describe, expect, it, vi } from "vitest";
import { emptyMaterialFilters, fetchMaterialVendors, materialFiltersToSearch, parseMaterialFilters } from "./catalog.ts";

describe("состояние каталога материалов в URL (MF-1476)", () => {
  it("восстанавливает фильтры и offset из прямой ссылки", () => {
    expect(parseMaterialFilters("?q=PLA&vendor=prusa&type=pla&kind=filament&color=%D1%87%D1%91%D1%80%D0%BD%D1%8B%D0%B9&offset=48")).toEqual({
      q: "PLA",
      vendor: "prusa",
      type: "pla",
      kind: "filament",
      color: "чёрный",
      offset: 48,
    });
  });

  it("сбрасывает неизвестный kind и не пишет offset первой страницы", () => {
    expect(materialFiltersToSearch(parseMaterialFilters("?kind=invalid"), 0)).toBe("");
    expect(materialFiltersToSearch({ ...emptyMaterialFilters(), q: "PLA" }, 48)).toBe("?q=PLA&offset=48");
  });

  it("нормализует русское название цвета для API", () => {
    expect(materialFiltersToSearch({ ...emptyMaterialFilters(), color: "Чёрный" })).toBe("?color=black");
  });

  it("не подменяет общий текстовый поиск словарём цветов (MF-1888)", () => {
    expect(materialFiltersToSearch({ ...emptyMaterialFilters(), q: "Чёрный" })).toBe("?q=%D0%A7%D1%91%D1%80%D0%BD%D1%8B%D0%B9");
    expect(materialFiltersToSearch({ ...emptyMaterialFilters(), q: "Чёрный", color: "Чёрный" })).toBe(
      "?q=%D0%A7%D1%91%D1%80%D0%BD%D1%8B%D0%B9&color=black",
    );
  });

  it("загружает полный справочник производителей", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ vendors: [{ id: "v1", slug: "bambu-lab", name: "Bambu Lab", verified: false }] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(fetchMaterialVendors()).resolves.toEqual([{ id: "v1", slug: "bambu-lab", name: "Bambu Lab", verified: false }]);
    expect(fetchMock).toHaveBeenCalledWith("/vendors", { credentials: "include", signal: undefined });
    vi.unstubAllGlobals();
  });
});
