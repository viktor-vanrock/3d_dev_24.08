import { describe, expect, it } from "vitest";
import { hasFeedBlockContent, parseFeedBlocks, parseFeedEmbed, serializeFeedBlocks } from "./blockcodec.ts";

describe("блочный редактор ленты", () => {
  it("сохраняет поддерживаемые типы блоков при разборе и сборке Markdown", () => {
    const markdown = "Текст\n\n## Подзаголовок\n\n- Первый пункт\n- Второй пункт";

    expect(serializeFeedBlocks(parseFeedBlocks(markdown))).toBe(markdown);
  });

  it("не теряет многострочный текст неизвестного формата", () => {
    const markdown = "Первая строка\nвторая строка";

    expect(serializeFeedBlocks(parseFeedBlocks(markdown))).toBe(markdown);
  });

  it("распознаёт ```mermaid-фенс как diagram-блок и сохраняет его при сборке (2026-07-21)", () => {
    const markdown = "Текст перед схемой.\n\n```mermaid\ngraph TD\n  A --> B\n```\n\nТекст после.";

    const blocks = parseFeedBlocks(markdown);
    expect(blocks.some((block) => block.type === "diagram")).toBe(true);
    const diagram = blocks.find((block) => block.type === "diagram");
    expect(diagram?.content).toBe("graph TD\n  A --> B");
    expect(serializeFeedBlocks(blocks)).toBe(markdown);
  });

  it("обычный ``` -код без mermaid остаётся code-блоком, не diagram", () => {
    const markdown = "```\nconst x = 1;\n```";

    const blocks = parseFeedBlocks(markdown);
    expect(blocks[0]?.type).toBe("code");
  });

  it("сохраняет rich-блоки внутри совместимой Markdown-строки", () => {
    const blocks = [
      { type: "text" as const, content: "Как собрал корпус." },
      {
        type: "model" as const,
        content: JSON.stringify({
          kind: "model",
          id: "m-1",
          title: "Корпус датчика",
          thumbUrl: "https://dev.3mf.tech/assets/model.webp",
        }),
      },
      {
        type: "gitverse" as const,
        content: JSON.stringify({
          kind: "gitverse",
          url: "https://gitverse.ru/maker/sensor/tree/main/case",
          title: "sensor / case",
        }),
      },
    ];

    const markdown = serializeFeedBlocks(blocks);
    const parsed = parseFeedBlocks(markdown);

    expect(markdown).toContain("<!-- portal:embed");
    expect(markdown).toContain("[3D-модель «Корпус датчика»](/project/m-1)");
    expect(parsed.map((block) => block.type)).toEqual(["text", "model", "gitverse"]);
    expect(parseFeedEmbed(parsed[1]!.content)?.id).toBe("m-1");
    expect(serializeFeedBlocks(parsed)).toBe(markdown);
    expect(hasFeedBlockContent(markdown)).toBe(true);
  });

  it("не считает незаполненную rich-заготовку содержимым", () => {
    expect(hasFeedBlockContent(serializeFeedBlocks([{ type: "image", content: JSON.stringify({ kind: "image" }) }]))).toBe(false);
  });
});
