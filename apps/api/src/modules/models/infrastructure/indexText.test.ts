import { describe, expect, it } from "vitest";
import { buildModelIndexText, DEFAULT_MAX_INDEX_TOKENS } from "./indexText.ts";

describe("buildModelIndexText", () => {
  it("concatenates title, description and tags", () => {
    const text = buildModelIndexText({
      title: "Statuette Дракончик",
      description: "Милый дракончик для стола",
      tags: ["дракон", "фэнтези"],
    });
    expect(text).toContain("Statuette Дракончик");
    expect(text).toContain("Милый дракончик для стола");
    expect(text).toContain("дракон, фэнтези");
  });

  it("is deterministic for the same input", () => {
    const model = { title: "A", description: "B", tags: ["c", "d"] };
    expect(buildModelIndexText(model)).toBe(buildModelIndexText(model));
  });

  it("handles an empty/null description without throwing and without stray whitespace", () => {
    const text = buildModelIndexText({ title: "Just a title", description: null, tags: [] });
    expect(text).toBe("Just a title");

    const text2 = buildModelIndexText({ title: "Just a title", description: "", tags: [] });
    expect(text2).toBe("Just a title");
  });

  it("drops empty/blank tags", () => {
    const text = buildModelIndexText({ title: "T", description: null, tags: ["", "  ", "real"] });
    expect(text).toBe("T\n\nreal");
  });

  it("strips markdown image/link syntax and headings from the description", () => {
    const text = buildModelIndexText({
      title: "T",
      description: "# Заголовок\n\nСмотри ![alt](https://x/1.png) и [ссылку](https://x)",
      tags: [],
    });
    expect(text).not.toContain("![");
    expect(text).not.toContain("](");
    expect(text).not.toContain("#");
    expect(text).toContain("Заголовок");
    expect(text).toContain("Смотри alt и ссылку");
  });

  it("truncates a very long document to the token limit, cutting on a word boundary", () => {
    const longDescription = "слово ".repeat(10_000); // ~60000 символов, далеко за дефолтным лимитом
    const text = buildModelIndexText({ title: "T", description: longDescription, tags: [] });

    const maxChars = DEFAULT_MAX_INDEX_TOKENS * 2.5;
    expect(text.length).toBeLessThanOrEqual(maxChars);
    // не обрублен на середине слова
    expect(text.endsWith("слово") || text.endsWith("T")).toBe(true);
  });

  it("respects a custom maxTokens option", () => {
    const longDescription = "слово ".repeat(1000);
    const text = buildModelIndexText({ title: "T", description: longDescription, tags: [] }, { maxTokens: 10 });
    expect(text.length).toBeLessThanOrEqual(Math.floor(10 * 2.5) + "T\n\n".length);
  });

  it("returns the same result regardless of description whitespace formatting differences", () => {
    const a = buildModelIndexText({ title: "T", description: "line1\r\nline2\n\n\n\nline3", tags: [] });
    expect(a).toBe("T\n\nline1\nline2\n\nline3");
  });
});
