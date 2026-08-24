import { describe, expect, it } from "vitest";
import { projectSummary } from "./projecttile.utils.ts";

describe("projectSummary", () => {
  it("превращает Markdown-описание в чистый текст для карточки проекта", () => {
    expect(
      projectSummary("## Настольная лампа\n\n[Схема](https://example.com) и **пошаговая** сборка `без пайки`."),
    ).toBe("Настольная лампа Схема и пошаговая сборка без пайки.");
  });

  it("не придумывает состав проекта, если автор не добавил описание", () => {
    expect(projectSummary(null)).toBe("Автор пока не добавил описание и последовательность сборки.");
  });
});
