import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ProjectSkeletonGrid } from "./projectspage.tsx";

afterEach(cleanup);

describe("ProjectSkeletonGrid (MF-2050)", () => {
  it("резервирует шесть полноразмерных карточек до ответа каталога", () => {
    const { container, getByRole } = render(<ProjectSkeletonGrid />);
    expect(getByRole("status", { name: "Загрузка проектов" })).toBeTruthy();
    expect(container.querySelectorAll(".projectTileSkeleton")).toHaveLength(6);
    expect(container.querySelectorAll(".projectTileSkeletonCover")).toHaveLength(6);
  });
});
