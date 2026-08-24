import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { OverlayProvider } from "@platform/overlay";
import { ThemeProvider } from "@platform/theme";
import { LoginPage } from "./login.tsx";

afterEach(() => {
  cleanup();
  window.history.pushState(null, "", "/");
});

describe("LoginPage", () => {
  it("объясняет назначение портала до формы входа", () => {
    render(
      <ThemeProvider>
        <OverlayProvider>
          <LoginPage />
        </OverlayProvider>
      </ThemeProvider>,
    );

    expect(screen.getByText("3MF · ПОРТАЛ ДЛЯ 3D-ПЕЧАТИ")).toBeTruthy();
    expect(screen.getByRole("heading", { level: 1, name: "Печатайте идеи — от модели до готовой детали" })).toBeTruthy();
    expect(screen.getByText("Находите 3D-модели, готовьте их к печати и управляйте принтерами в одном месте.")).toBeTruthy();
    expect(screen.getByRole("textbox", { name: "Рабочая почта" })).toBeTruthy();
  });
});
