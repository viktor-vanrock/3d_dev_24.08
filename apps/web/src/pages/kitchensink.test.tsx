import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { OverlayProvider } from "@platform/overlay";
import { ThemeProvider } from "@platform/theme";
import { KitchenSinkPage } from "./kitchensink.tsx";

afterEach(cleanup);

describe("KitchenSinkPage", () => {
  it("показывает живой пример form-модалки", async () => {
    const user = userEvent.setup();
    render(
      <ThemeProvider>
        <OverlayProvider>
          <KitchenSinkPage />
        </OverlayProvider>
      </ThemeProvider>,
    );

    await user.click(screen.getByRole("button", { name: "Открыть form-модалку" }));

    const dialog = await screen.findByRole("dialog", { name: "Форма принтера" });
    expect(dialog.getAttribute("data-size")).toBe("form");
  });
});
