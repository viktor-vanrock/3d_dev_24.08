import { describe, expect, it } from "vitest";
import { listPrintersFixture } from "./fixtures.ts";
import {
  applyFacets,
  brandCounts,
  computeGap,
  emptyFacetState,
  facetsToSearch,
  isStalePrice,
  parseFacetsFromSearch,
  sortPrinters,
  wouldBeEmpty,
} from "./facets.ts";

// Фасетная логика каталога `/printers` (MF-927, docs/design/printers.catalog.md §2) — чистые
// функции без DOM, чтобы гашение нулевых опций (§2.8) и `GapRow` (§2.9) можно было проверить
// независимо от разметки сайдбара.

async function fixtures() {
  return listPrintersFixture();
}

describe("parseFacetsFromSearch / facetsToSearch (§10 «состояние в URL»)", () => {
  it("round-trip: пустое состояние → пустая строка → пустое состояние", () => {
    const state = emptyFacetState();
    expect(facetsToSearch(state)).toBe("");
    expect(parseFacetsFromSearch("")).toEqual(state);
  });

  it("round-trip с активными фильтрами", () => {
    const state = { ...emptyFacetState(), q: "K1", brands: ["Creality", "Prusa"], kinematics: ["corexy" as const], sort: "new" as const };
    const search = facetsToSearch(state);
    expect(parseFacetsFromSearch(search)).toEqual(state);
  });
});

describe("supportLevel facet (MF-892)", () => {
  it("фильтрует по support_level, list — дефолт для printer без поля", async () => {
    const printers = await fixtures();
    const managed = applyFacets(printers, { ...emptyFacetState(), supportLevel: ["managed"] });
    expect(managed.every((p) => p.support_level === "managed")).toBe(true);
    expect(managed.length).toBeGreaterThan(0);

    const custom = applyFacets(printers, { ...emptyFacetState(), supportLevel: ["custom"] });
    expect(custom.every((p) => p.support_level === "custom")).toBe(true);
    expect(custom.length).toBeGreaterThan(0);
  });

  it("round-trip через URL сохраняет supportLevel", () => {
    const state = { ...emptyFacetState(), supportLevel: ["managed" as const, "custom" as const] };
    const search = facetsToSearch(state);
    expect(parseFacetsFromSearch(search)).toEqual(state);
  });
});

describe("applyFacets", () => {
  it("бренд — объединение (OR), не пересечение", async () => {
    const printers = await fixtures();
    const state = { ...emptyFacetState(), brands: ["Creality", "Prusa"] };
    const result = applyFacets(printers, state);
    expect(result.every((p) => p.brand === "Creality" || p.brand === "Prusa")).toBe(true);
    expect(result.some((p) => p.brand === "Creality")).toBe(true);
    expect(result.some((p) => p.brand === "Prusa")).toBe(true);
  });

  it("возможности — пересечение (AND): AMS + лазер оставляет только K2 Plus", async () => {
    const printers = await fixtures();
    const state = { ...emptyFacetState(), capabilities: ["ams" as const, "laser" as const] };
    const result = applyFacets(printers, state);
    expect(result.map((p) => p.id)).toEqual(["creality.k2-plus"]);
  });

  it("материалы — AND (§2.7): PLA и PA-CF сразу сужает до принтеров с обоими", async () => {
    const printers = await fixtures();
    const state = { ...emptyFacetState(), materials: ["PLA", "PA-CF"] };
    const result = applyFacets(printers, state);
    expect(result.every((p) => p.materials_supported.includes("PLA") && p.materials_supported.includes("PA-CF"))).toBe(true);
    expect(result.length).toBeGreaterThan(0);
  });

  it("«влезет деталь» режет по build_volume, принтеры без объёма исключаются", async () => {
    const printers = await fixtures();
    const state = { ...emptyFacetState(), fitX: 300, fitY: 300, fitZ: 300 };
    const result = applyFacets(printers, state);
    expect(result.every((p) => {
      const bv = p.build_volume as Record<string, unknown>;
      return typeof bv.x === "number" && bv.x >= 300 && typeof bv.y === "number" && bv.y >= 300 && typeof bv.z === "number" && bv.z >= 300;
    })).toBe(true);
    // announced/rumored фикстуры без build_volume не проходят фильтр
    expect(result.some((p) => p.id === "vulcan.one")).toBe(false);
  });

  it("цена: принтер без известной цены не режется молча фильтром цены", async () => {
    const printers = await fixtures();
    const state = { ...emptyFacetState(), priceMin: 100000, priceMax: 200000 };
    const result = applyFacets(printers, state);
    // prusa.mk4 — ru_rub=null, должен остаться в выдаче несмотря на диапазон
    expect(result.some((p) => p.id === "prusa.mk4")).toBe(true);
  });
});

describe("brandCounts (§2.2, §2.8)", () => {
  it("считает по выборке без учёта своего же фильтра бренда", async () => {
    const printers = await fixtures();
    const state = { ...emptyFacetState(), brands: ["Creality"] };
    const counts = brandCounts(printers, state);
    const prusa = counts.find((c) => c.brand === "Prusa");
    expect(prusa?.count).toBe(1);
  });

  it("бренд без совпадений при текущих фильтрах гасится (zero=true)", async () => {
    const printers = await fixtures();
    const state = { ...emptyFacetState(), kind: "resin" as const };
    const counts = brandCounts(printers, state);
    const creality = counts.find((c) => c.brand === "Creality");
    expect(creality?.zero).toBe(true);
    const elegoo = counts.find((c) => c.brand === "Elegoo");
    expect(elegoo?.zero).toBe(false);
  });
});

describe("wouldBeEmpty (§2.8 гашение нулевых опций)", () => {
  it("несовместимая комбинация кинематики+типа гаснет", async () => {
    const printers = await fixtures();
    const state = { ...emptyFacetState(), kind: "resin" as const };
    const zero = wouldBeEmpty(printers, state, "kinematics", { ...state, kinematics: ["corexy"] });
    expect(zero).toBe(true);
  });
});

describe("computeGap (§2.9 GapRow)", () => {
  it("фильтр по кинематике исключает принтеры без известной кинематики (elegoo)", async () => {
    const printers = await fixtures();
    const state = { ...emptyFacetState(), kinematics: ["corexy" as const] };
    const gap = computeGap(printers, state);
    expect(gap).not.toBeNull();
    expect(gap?.field).toBe("кинематика");
    expect(gap?.count).toBeGreaterThan(0);
  });

  it("без активных фасетов с полем — гэпа нет", async () => {
    const printers = await fixtures();
    const gap = computeGap(printers, emptyFacetState());
    expect(gap).toBeNull();
  });

  it("чип «Автокалибровка» (§2.6) режет по null-полю bed.auto_leveling — не молчит", async () => {
    const printers = await fixtures();
    const state = { ...emptyFacetState(), capabilities: ["auto_leveling" as const] };
    const gap = computeGap(printers, state);
    // elegoo.saturn4-ultra (auto_leveling: null) и vulcan.one/nebula.zero (bed: {}) — честный
    // пробел; creality.ender3-v2 (auto_leveling: "none") — явное «нет», в счёт гэпа не идёт.
    expect(gap).not.toBeNull();
    expect(gap?.field).toBe("автокалибровка стола");
    expect(gap?.count).toBe(3);
    expect(gap?.capabilityKey).toBe("auto_leveling");
  });
});

describe("sortPrinters", () => {
  it("recommended — verified вперёд, ни один unverified не опережает verified", async () => {
    const printers = await fixtures();
    const sorted = sortPrinters(printers, emptyFacetState());
    const firstUnverifiedIndex = sorted.findIndex((p) => !p._meta.verified);
    expect(firstUnverifiedIndex).toBeGreaterThan(0);
    expect(sorted.slice(firstUnverifiedIndex).every((p) => !p._meta.verified)).toBe(true);
  });

  it("непустой q переключает дефолт на «relevant» без явного выбора сортировки", async () => {
    const printers = await fixtures();
    const state = { ...emptyFacetState(), q: "creality" };
    // relevant сегодня совпадает с recommended (verified вперёд) — проверяем, что сортировка не падает
    expect(() => sortPrinters(printers, state)).not.toThrow();
  });

  it("build_volume — больше стол первым", async () => {
    const printers = await fixtures();
    const sorted = sortPrinters(printers, { ...emptyFacetState(), sort: "build_volume" });
    expect(sorted[0]?.id).toBe("creality.k2-plus"); // 350x350x350, самый большой в фикстуре
  });
});

describe("isStalePrice (§2.11)", () => {
  it("цена старше 90 дней помечается устаревшей", async () => {
    const printers = await fixtures();
    const bambu = printers.find((p) => p.id === "bambulab.x1-carbon")!;
    const today = new Date("2026-07-11T00:00:00Z").getTime();
    expect(isStalePrice(bambu, today)).toBe(true);
  });

  it("свежая цена не помечается", async () => {
    const printers = await fixtures();
    const k1 = printers.find((p) => p.id === "creality.k1-max")!;
    const today = new Date("2026-07-11T00:00:00Z").getTime();
    expect(isStalePrice(k1, today)).toBe(false);
  });
});
