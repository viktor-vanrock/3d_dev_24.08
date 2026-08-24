import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { CommunityKindBadge, RoleBadge, ThreadTypeBadge } from "./badges.tsx";

afterEach(() => cleanup());

describe("CommunityKindBadge (community.md §7.1)", () => {
  it("скрыт для kind='custom' — нет отдельного «типа» у пользовательских клубов", () => {
    const { container } = render(<CommunityKindBadge kind="custom" />);
    expect(container.innerHTML).toBe("");
  });

  it("показывает метку для системных kind", () => {
    render(<CommunityKindBadge kind="machine" />);
    expect(screen.getByText("Принтер")).toBeTruthy();
  });
});

describe("RoleBadge (community.md §7.2)", () => {
  it("role=null (не состою) — ничего не рендерит", () => {
    const { container } = render(<RoleBadge role={null} />);
    expect(container.innerHTML).toBe("");
  });

  it("показывает только собственную роль", () => {
    render(<RoleBadge role="owner" />);
    expect(screen.getByText("Владелец")).toBeTruthy();
  });
});

describe("ThreadTypeBadge (community.md §7.3)", () => {
  it("вопрос без accepted_post_id — без «✓ решён»", () => {
    render(<ThreadTypeBadge type="question" solved={false} />);
    expect(screen.getByLabelText("Тип треда: Вопрос")).toBeTruthy();
    expect(screen.queryByText(/решён/)).toBeNull();
  });

  it("решённый вопрос сообщает тип и статус отдельными доступными элементами", () => {
    render(<ThreadTypeBadge type="question" solved />);
    expect(screen.getByLabelText("Тип треда: Вопрос")).toBeTruthy();
    expect(screen.getByRole("status", { name: "Статус треда: решён" })).toBeTruthy();
  });
});
