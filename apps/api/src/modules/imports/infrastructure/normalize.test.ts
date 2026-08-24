import { describe, expect, it } from "vitest";
import type { ExternalModelMeta } from "./connector.ts";
import { mapLicense, normalize } from "./normalize.ts";

// Мок-метаданные в форме Cults3D GraphQL creation (карточка MF-739 — первый источник эпика
// MF-37/MF-417): поля licence/tags/category/nbLikes-подобные счётчики популярности —
// как их реально отдаёт https://cults3d.com/graphql.
function cults3dMeta(overrides: Partial<ExternalModelMeta> = {}): ExternalModelMeta {
  return {
    externalId: "123456",
    originalUrl: "https://cults3d.com/en/3d-model/gadget/example-widget",
    title: "  Example Widget  ",
    description: "  A widget for testing.  ",
    license: "Creative Commons - Attribution - Non Commercial",
    tags: ["Gadget", "widget", "GADGET"],
    category: "Gadgets",
    popularity: { nbLikes: 42, nbDownloads: 108, nbViews: 999 },
    raw: { creationId: "123456" },
    ...overrides,
  };
}

describe("mapLicense", () => {
  it("maps known Cults3D CC licenses to our taxonomy", () => {
    expect(mapLicense("Creative Commons - Attribution")).toBe("cc-by");
    expect(mapLicense("Creative Commons - Attribution - Share Alike")).toBe("cc-by-sa");
    expect(mapLicense("Creative Commons - Attribution - Non Commercial")).toBe("cc-by-nc");
    expect(mapLicense("Creative Commons - Public Domain Dedication (CC0)")).toBe("cc0");
  });

  it("maps Cults3D proprietary license text to 'proprietary', not 'unknown'", () => {
    expect(mapLicense("The Cults3D Original Works License Agreement")).toBe("proprietary");
    expect(mapLicense("Standard Digital File License")).toBe("proprietary");
  });

  it("is case- and whitespace-insensitive", () => {
    expect(mapLicense("  creative commons -   attribution  ")).toBe("cc-by");
  });

  it("falls back to 'unknown' for unrecognized license text", () => {
    expect(mapLicense("Some Future License We've Never Seen")).toBe("unknown");
  });
});

describe("normalize", () => {
  it("maps a Cults3D-shaped draft end to end", () => {
    const draft = normalize(cults3dMeta());

    expect(draft.title).toBe("Example Widget");
    expect(draft.description).toBe("A widget for testing.");
    expect(draft.license).toBe("cc-by-nc");
    expect(draft.sourceLicense).toBe("Creative Commons - Attribution - Non Commercial");
    expect(draft.category).toBe("gadgets");
    expect(draft.sourcePopularity).toEqual({ nbLikes: 42, nbDownloads: 108, nbViews: 999 });
  });

  it("lowercases and dedupes tags, folding the category in as a tag", () => {
    const draft = normalize(cults3dMeta());
    expect(draft.tags).toEqual(["gadget", "widget", "gadgets"]);
  });

  it("dedupes a tag that already equals the category", () => {
    const draft = normalize(cults3dMeta({ tags: ["gadget", "Gadgets"], category: "Gadgets" }));
    expect(draft.tags).toEqual(["gadget", "gadgets"]);
  });

  it("caps tags at 8 and drops overflow", () => {
    const draft = normalize(cults3dMeta({ tags: ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"], category: undefined }));
    expect(draft.tags).toHaveLength(8);
    expect(draft.tags).toEqual(["a", "b", "c", "d", "e", "f", "g", "h"]);
  });

  it("omits description and category when absent from source meta", () => {
    const draft = normalize(cults3dMeta({ description: undefined, category: undefined, tags: [] }));
    expect(draft.description).toBeUndefined();
    expect(draft.category).toBeUndefined();
    expect(draft.tags).toEqual([]);
  });

  it("treats a blank description as absent", () => {
    const draft = normalize(cults3dMeta({ description: "   " }));
    expect(draft.description).toBeUndefined();
  });

  it("drops negative and non-finite popularity counters as source garbage", () => {
    const draft = normalize(cults3dMeta({ popularity: { nbLikes: 42, nbDownloads: -5, nbViews: Number.NaN } }));
    expect(draft.sourcePopularity).toEqual({ nbLikes: 42 });
  });

  it("truncates fractional popularity counters", () => {
    const draft = normalize(cults3dMeta({ popularity: { nbLikes: 42.9 } }));
    expect(draft.sourcePopularity).toEqual({ nbLikes: 42 });
  });
});
