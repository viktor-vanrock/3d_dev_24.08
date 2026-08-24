import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migratedScreens = [
  "communitylist.tsx",
  "communityscreen.tsx",
  "threadscreen.tsx",
  "flagdialog.tsx",
] as const;

describe("community UI-kit migration (MF-1893)", () => {
  it.each(migratedScreens)("%s не обходит общий Button сырой разметкой", (file) => {
    const source = readFileSync(new URL(file, import.meta.url), "utf8");

    expect(source).not.toMatch(/<button\b/);
  });
});
