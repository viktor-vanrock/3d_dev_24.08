import { describe, expect, it } from "vitest";
import { appendStableFeedKeys, type FeedTileKey } from "./home.feedmixer.ts";

function items(prefix: string, count: number) {
  return Array.from({ length: count }, (_, index) => ({ id: `${prefix}-${index + 1}` }));
}

describe("редакторская плетёнка главной", () => {
  it("меняет ритм рядов, сохраняя равный баланс проектов и концептов", () => {
    const mixed = appendStableFeedKeys([], items("model", 8), items("concept", 8));

    expect(mixed.map((item) => item.source)).toEqual([
      "model", "concept", "model", "concept",
      "concept", "model", "model", "concept",
      "model", "concept", "concept", "model",
      "concept", "model", "concept", "model",
    ]);
  });

  it("не переставляет показанные карточки при поступлении следующей страницы", () => {
    const initial = appendStableFeedKeys([], items("model", 8), items("concept", 8));
    const next = appendStableFeedKeys(
      initial,
      items("model", 10),
      items("concept", 10),
    );

    expect(next.slice(0, initial.length)).toEqual(initial);
    expect(next.slice(initial.length)).toEqual<FeedTileKey[]>([
      { source: "model", id: "model-9" },
      { source: "concept", id: "concept-9" },
      { source: "model", id: "model-10" },
      { source: "concept", id: "concept-10" },
    ]);
  });
});
