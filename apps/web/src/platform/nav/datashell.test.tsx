import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SessionUser } from "@shared/types";
import { DataShell } from "./datashell.tsx";

vi.mock("./homeheader.tsx", () => ({ HomeHeader: () => <header data-testid="site-header">Навигация</header> }));

const user: SessionUser = {
  id: "user-1",
  username: "devuser",
  display_name: "DEV Reviewer",
  avatar_url: null,
  handle_confirmed: true,
  role: "user",
  capabilities: ["data.materials.manage", "data.news.manage"],
};

afterEach(cleanup);

describe("DataShell", () => {
  it("резервирует рабочую область под fixed-header и показывает breadcrumb", () => {
    const { container } = render(
      <DataShell user={user} section="market" onSectionChange={() => undefined} active="materials" trail="Новый материал">
        <div>Редактор</div>
      </DataShell>,
    );

    expect(container.querySelector(".dataShellContent")).toBeTruthy();
    expect(screen.getByRole("navigation", { name: "Хлебные крошки" }).textContent).toContain(
      "Данные/Материалы/Новый материал",
    );
  });

  it("показывает только разрешённые подразделы и отмечает активный", () => {
    render(
      <DataShell user={user} section="market" onSectionChange={() => undefined} active="materials">
        <div />
      </DataShell>,
    );

    const subnav = within(screen.getByRole("navigation", { name: "Разделы данных" }));
    expect(subnav.getByRole("link", { name: "Материалы" }).getAttribute("aria-current")).toBe("page");
    expect(subnav.getByRole("link", { name: "Новости" })).toBeTruthy();
    expect(subnav.queryByRole("link", { name: "Принтеры" })).toBeNull();
  });

  it("сохраняет навигацию Данных на экране без разрешения текущего подраздела", () => {
    render(
      <DataShell user={user} section="market" onSectionChange={() => undefined} active="printers">
        <div>Недостаточно прав</div>
      </DataShell>,
    );

    expect(screen.getByRole("navigation", { name: "Разделы данных" })).toBeTruthy();
    expect(screen.getByText("Недостаточно прав")).toBeTruthy();
  });
});
