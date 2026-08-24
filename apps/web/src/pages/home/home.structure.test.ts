import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const homeDirectory = resolve(process.cwd(), "src/pages/home");

function source(file: string) {
  return readFileSync(`${homeDirectory}/${file}`, "utf8");
}

function lineCount(file: string) {
  return source(file).trimEnd().split("\n").length;
}

describe("границы модулей главной (MF-919)", () => {
  it("держит композицию, поиск, витрину и иконки в отдельных TSX-модулях", () => {
    expect(source("home.tsx")).toContain('from "./home.search.tsx"');
    expect(source("home.tsx")).toContain('from "./home.showcase.tsx"');
    expect(source("home.search.tsx")).toContain('from "./home.icons.tsx"');

    for (const file of ["home.tsx", "home.search.tsx", "home.showcase.tsx", "home.icons.tsx"]) {
      expect(lineCount(file), `${file} снова стал файлом-гигантом`).toBeLessThanOrEqual(400);
    }
  });

  it("собирает CSS из функциональных секций без новых файлов-гигантов", () => {
    const sectionFiles = [
      "home.shell.css",
      "home.topbar.css",
      "home.capsule.css",
      "home.popover.css",
      "home.search.css",
      "home.showcase.css",
      "home.concepts.css",
      "home.conceptqueue.css",
      "home.persona.css",
      "home.interactions.css",
      "home.avatar.editor.css",
      "home.avatar.responsive.css",
      "home.returning.css",
    ];
    const entrypoint = source("home.css");

    for (const file of sectionFiles) {
      expect(entrypoint).toContain(`@import "./${file}";`);
      expect(lineCount(file), `${file} снова стал файлом-гигантом`).toBeLessThanOrEqual(400);
    }
  });
});
