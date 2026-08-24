import { cleanup, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SegmentToggle } from "./segmenttoggle.tsx";

afterEach(() => {
  cleanup();
});

describe("Визуальное состояние SegmentToggle", () => {
  it("рисует выбранный таб сплошной контрастной Figma-пилюлей без галочки", () => {
    const { container } = render(
      <SegmentToggle
        ariaLabel="Разделы"
        options={[
          { value: "home", label: "Дом" },
          { value: "feed", label: "Новости" },
          { value: "printers", label: "Принтеры" },
          { value: "market", label: "Проекты" },
        ]}
        value="feed"
        onChange={() => undefined}
      />,
    );

    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual(["Дом", "Новости", "Принтеры", "Проекты"]);
    expect(screen.getByRole("tab", { name: "Новости" }).getAttribute("aria-selected")).toBe("true");
    expect(container.querySelector(".uiSegmentToggleFill")).toBeTruthy();

    const styles = readFileSync(resolve(process.cwd(), "src/shared/ui/ui.css"), "utf8");
    const selectedRule = styles.match(/\.uiSegmentToggleOption\[data-selected="true"\] \{([^}]*)\}/)?.[1] ?? "";
    const activeRule = styles.match(/\.uiSegmentToggleOption\[data-active="true"\] \{([^}]*)\}/)?.[1] ?? "";
    const fillRule = styles.match(/\.uiSegmentToggleFill \{([^}]*)\}/)?.[1] ?? "";

    expect(styles).not.toMatch(/\.uiSegmentToggleOption\[data-selected="true"\]::before/);
    expect(selectedRule).not.toMatch(/border-color|box-shadow/);
    expect(fillRule).toMatch(/border-radius:\s*var\(--tab-radius\)/);
    expect(fillRule).toMatch(/background:\s*var\(--accent\)/);
    expect(activeRule).toMatch(/color:\s*var\(--accent-contrast\)/);
  });
});
