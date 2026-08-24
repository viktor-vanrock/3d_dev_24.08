import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { ThemeProvider } from "@platform/theme";
import { ResearcherRoleGate } from "./researchgate.tsx";
import type { SessionUser } from "@shared/types";

afterEach(() => {
  cleanup();
});

const baseUser: SessionUser = { id: "u1", username: "tester", display_name: null, avatar_url: null, handle_confirmed: true, role: "user" };

// Гейт роли (§0): "не 404, не «доступ запрещён»" — EmptyState вербует, не отказывает.
describe("ResearcherRoleGate (MF-917)", () => {
  it("роль researcher → рендерит детей как есть", () => {
    render(
      <ThemeProvider>
        <ResearcherRoleGate user={{ ...baseUser, role: "researcher" }}>
          <div>форма карточки</div>
        </ResearcherRoleGate>
      </ThemeProvider>,
    );
    expect(screen.getByText("форма карточки")).toBeTruthy();
  });

  it("роли нет → вербующий EmptyState, не «доступ запрещён»/404, дети не рендерятся", () => {
    render(
      <ThemeProvider>
        <ResearcherRoleGate user={baseUser}>
          <div>форма карточки</div>
        </ResearcherRoleGate>
      </ThemeProvider>,
    );
    expect(screen.queryByText("форма карточки")).toBeNull();
    expect(screen.getByText("Это рабочее место команды Ресёрчеров")).toBeTruthy();
    expect(screen.queryByText(/403|404|доступ запрещён/i)).toBeNull();
    expect(screen.getByText(/Хочу заполнять каталог/)).toBeTruthy();
  });
});
