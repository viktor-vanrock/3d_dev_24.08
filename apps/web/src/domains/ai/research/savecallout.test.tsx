import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConflictSection } from "./savecallout.tsx";

afterEach(cleanup);

describe("ConflictSection", () => {
  it("показывает даты и сложные значения без [object Object]", () => {
    render(
      <ConflictSection
        conflicts={[
          { field: "released_at", theirs: "2026-09-17", ours: "2026-09-18" },
          { field: "media", theirs: { hero: "mine.webp" }, ours: { hero: "theirs.webp" } },
        ]}
        resolutions={{}}
        onResolve={vi.fn()}
      />,
    );
    expect(screen.getByText("моё: 2026-09-17")).toBeTruthy();
    expect(screen.getByText('их: {"hero":"theirs.webp"}')).toBeTruthy();
    expect(screen.queryByText(/\[object Object\]/)).toBeNull();
  });

  it("понятно отображает пустое значение", () => {
    render(<ConflictSection conflicts={[{ field: "released_at", theirs: null, ours: null }]} resolutions={{}} onResolve={vi.fn()} />);
    expect(screen.getAllByText(/не указано/)).toHaveLength(2);
  });
});
