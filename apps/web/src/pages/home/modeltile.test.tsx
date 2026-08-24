import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { OverlayProvider } from "@platform/overlay";
import type { MarketModel } from "@domains/commerce";
import { isShowcaseModel, ModelTileButton, ModelTileGrid } from "./modeltile.tsx";

const longTitle = "wall-honeycomb-224x190size(mk3s)-very-long-printable-model-name";

const model: MarketModel = {
  id: "model-1",
  title: longTitle,
  description: null,
  status: "ready" as const,
  source_format: "stl",
  craft: "3d_printing" as const,
  manufacturing_method: null,
  requires_ams: false,
  created_at: new Date(0).toISOString(),
  votes_up: 4,
  votes_down: 0,
  downloads_count: 12,
  tags: [],
  thumb_url: null,
  owner: { id: "owner-1", username: "maker" },
  project_summary: { file_count: 1, build_steps_count: 0 },
};

afterEach(cleanup);

describe("ModelTileButton", () => {
  it("допускает в домашнюю витрину только модель с файлами и настоящим preview", () => {
    expect(isShowcaseModel(model)).toBe(false);
    expect(isShowcaseModel({ ...model, thumb_url: "/models/model-1/thumbnail" })).toBe(true);
    expect(
      isShowcaseModel({
        ...model,
        thumb_url: "/models/model-1/thumbnail",
        project_summary: { file_count: 0, build_steps_count: 0 },
      }),
    ).toBe(false);
  });

  it("сохраняет длинное название в ограниченном слоте заголовка", () => {
    const { container } = render(
      <OverlayProvider>
        <ModelTileButton model={model} />
      </OverlayProvider>,
    );

    const name = screen.getByText(longTitle);
    expect(name.className).toContain("homeModelName");
    expect(container.querySelector(".homeModelMeta")?.className).toContain("homeModelMeta");
    expect(container.querySelector(".homeModelGlow")).toBeNull();
    expect(name.textContent).toBe(longTitle);
  });

  it("убирает из витрины карточку с битым thumbnail", () => {
    const visualModel = { ...model, thumb_url: "/models/model-1/thumbnail" };
    const { container } = render(
      <OverlayProvider>
        <ModelTileButton model={visualModel} hideBrokenPreview />
      </OverlayProvider>,
    );

    fireEvent.error(container.querySelector("img")!);

    expect(screen.queryByRole("button", { name: (name) => name.startsWith(longTitle) })).toBeNull();
  });

  it("передаёт обработчику позицию карточки в сетке", () => {
    const onOpen = vi.fn();
    render(
      <OverlayProvider>
        <ModelTileGrid models={[model]} onOpen={onOpen} />
      </OverlayProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: (name) => name.startsWith(longTitle) }));

    expect(onOpen).toHaveBeenCalledWith(model, 0);
  });
});
