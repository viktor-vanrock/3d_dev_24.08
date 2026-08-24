import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OverlayProvider } from "@platform/overlay";
import { ThemeProvider } from "@platform/theme";
import { AvatarEditorPage } from "./avatareditor.tsx";
import "./home.css";

const user = {
  id: "avatar-studio-user",
  username: "maker",
  display_name: "Maker",
  avatar_url: null,
  handle_confirmed: true,
  role: "user" as const,
};

function renderEditor() {
  return render(
    <ThemeProvider>
      <OverlayProvider>
        <AvatarEditorPage user={user} section="home" onSectionChange={() => {}} />
      </OverlayProvider>
    </ThemeProvider>,
  );
}

beforeEach(() => {
  window.history.replaceState(null, "", "/profile/avatar");
  vi.stubGlobal("requestIdleCallback", vi.fn(() => 1));
  vi.stubGlobal("cancelIdleCallback", vi.fn());
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/me/wardrobe/unlocks")) {
        return Response.json({ layers: { outfit: ["none", "sweater", "overall", "labcoat", "techvest"] } });
      }
      if (url.endsWith("/me/avatar")) {
        return Response.json({
          config: {
            color: "mint",
            texture: "matte",
            pose: "stand",
            outfit: "none",
            hat: "none",
            eyes: "dots",
            beard: "none",
            arms: "plain",
            accessory: "none",
            back: "none",
          },
          snapshots: null,
        });
      }
      return new Response(null, { status: 202 });
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe("AvatarEditorPage", () => {
  it("показывает отдельную мастерскую с одним WebGL-слотом и лёгким SVG-каталогом", () => {
    const { container } = renderEditor();

    expect(screen.getByRole("heading", { name: "Соберите себя" })).toBeTruthy();
    expect(screen.getByRole("navigation", { name: "Категории персонажа" })).toBeTruthy();
    expect(container.querySelectorAll("canvas")).toHaveLength(1);
    expect(container.querySelector(".avatarStudioFallback svg")).toBeTruthy();
    expect(container.querySelectorAll(".avatarStudioTile canvas")).toHaveLength(0);
    expect(container.querySelectorAll(".avatarStudioTile svg").length).toBeGreaterThan(1);
  });

  it("открывает все слои и объясняет заблокированную ачивкой вещь", async () => {
    renderEditor();

    for (const category of ["Голова", "Лицо", "Борода", "Одежда", "Руки", "Предмет", "Поза", "Цвет", "Материал"]) {
      expect(screen.getByRole("button", { name: category })).toBeTruthy();
    }

    fireEvent.click(screen.getByRole("button", { name: "Одежда" }));
    const apron = await screen.findByRole("option", { name: /Фартук/ });
    await waitFor(() => expect(apron.getAttribute("disabled")).not.toBeNull());
    expect(apron.textContent).toContain("Первый Make");
    expect(apron.textContent).toContain("Закрыто");
  });
});
