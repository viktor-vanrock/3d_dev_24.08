import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("projects UI-kit migration (MF-1893)", () => {
  it.each(["projectspage.tsx", "hero.tsx"])("%s использует общие интерактивные примитивы", (file) => {
    const source = readFileSync(new URL(file, import.meta.url), "utf8");

    expect(source).not.toMatch(/<button\b/);
  });
});
