import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { serializeFeedBlocks } from "./blockcodec.ts";
import { FeedRichBody } from "./richbody.tsx";

afterEach(cleanup);

describe("FeedRichBody", () => {
  it("сохраняет порядок текста, фото и 3D-модели", () => {
    const source = serializeFeedBlocks([
      { type: "text", content: "Сначала напечатал прототип." },
      {
        type: "image",
        content: JSON.stringify({
          kind: "image",
          url: "/assets/prototype.webp",
          title: "Первый прототип",
        }),
      },
      { type: "heading-2", content: "Финальная версия" },
      {
        type: "model",
        content: JSON.stringify({
          kind: "model",
          id: "model-1",
          title: "Корпус датчика",
        }),
      },
    ]);

    const { container } = render(<FeedRichBody source={source} />);

    expect(screen.getByText("Сначала напечатал прототип.")).toBeTruthy();
    expect(screen.getByRole("img", { name: "Первый прототип" })).toBeTruthy();
    expect(screen.getByText("Финальная версия")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Корпус датчика/ })).toBeTruthy();
    const children = container.querySelector(".feedRichBody")?.children;
    expect(children).toHaveLength(4);
  });

  it("не рендерит произвольный внешний URL как изображение", () => {
    const source = serializeFeedBlocks([
      {
        type: "image",
        content: JSON.stringify({
          kind: "image",
          url: "https://tracker.example/pixel.gif",
          title: "Внешний пиксель",
        }),
      },
    ]);

    render(<FeedRichBody source={source} />);

    expect(screen.queryByRole("img", { name: "Внешний пиксель" })).toBeNull();
  });

  it("рендерит проверенное редакционное изображение с официального домена бренда", () => {
    const source = [
      "Вводный абзац.",
      "![Система быстрой смены сопла KliTek](https://compress-file.creality.com/images/klitek.webp)",
      "## Как это работает",
    ].join("\n\n");

    render(<FeedRichBody source={source} />);

    expect(screen.getByRole("img", { name: "Система быстрой смены сопла KliTek" })).toBeTruthy();
    expect(screen.getByText("Как это работает")).toBeTruthy();
  });

  it("скрывает служебные claim-якоря, не удаляя текст новости", () => {
    const source = [
      "Система меняет сопло за пять секунд [claim:claim_1].",
      "## Как это работает [claim:section.2]",
    ].join("\n\n");

    render(<FeedRichBody source={source} />);

    expect(screen.getByText("Система меняет сопло за пять секунд.")).toBeTruthy();
    expect(screen.getByText("Как это работает")).toBeTruthy();
    expect(screen.queryByText(/claim:/)).toBeNull();
  });

  it("рендерит источники карточками с доменом, не голыми ссылками (2026-07-21)", () => {
    const source = serializeFeedBlocks([
      {
        type: "sources",
        content: JSON.stringify({
          kind: "sources",
          items: [
            { url: "https://www.creality.com/blog/klitek", title: "Creality: KliTek" },
            { url: "https://all3dp.com/4/creality-k3", title: "All3DP" },
          ],
        }),
      },
    ]);

    const { container } = render(<FeedRichBody source={source} />);

    expect(screen.getByText("creality.com")).toBeTruthy();
    expect(screen.getByText("all3dp.com")).toBeTruthy();
    // Ссылка ведёт на реальный источник, не на голый текст в теле.
    const links = container.querySelectorAll(".feedRichSourceChip");
    expect(links).toHaveLength(2);
    expect(links[0]?.getAttribute("href")).toBe("https://www.creality.com/blog/klitek");
    expect(links[0]?.getAttribute("rel")).toContain("noopener");
  });

  it("отбрасывает невалидные URL источника, но рендерит остальные", () => {
    const source = serializeFeedBlocks([
      {
        type: "sources",
        content: JSON.stringify({
          kind: "sources",
          items: [
            { url: "not-a-url", title: "Битый" },
            { url: "https://fabbaloo.com/news", title: "Fabbaloo" },
          ],
        }),
      },
    ]);

    render(<FeedRichBody source={source} />);

    expect(screen.getByText("fabbaloo.com")).toBeTruthy();
    expect(screen.queryByText("Битый")).toBeNull();
  });
});
