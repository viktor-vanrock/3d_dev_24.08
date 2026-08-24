import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migratedScreens = [
  "comparescreen.tsx",
  "comparepanel.tsx",
  "gaprow.tsx",
] as const;

describe("printer compare UI-kit migration (MF-1893)", () => {
  it.each(migratedScreens)("%s не обходит общий Button сырой разметкой", (file) => {
    const source = readFileSync(new URL(file, import.meta.url), "utf8");

    expect(source).not.toMatch(/<button\b/);
  });
});
