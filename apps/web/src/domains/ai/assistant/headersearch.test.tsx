import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SessionUser } from "@shared/types";
import { ASSISTANT_CONTEXT_SEARCH_EVENT, ASSISTANT_OPEN_EVENT } from "./events.ts";
import { AssistantHeaderSearch } from "./headersearch.tsx";

vi.mock("@domains/access", () => ({ useGuestLogin: () => vi.fn() }));

const user: SessionUser = {
  id: "maker-1",
  username: "maker",
  display_name: "Maker",
  avatar_url: null,
  handle_confirmed: true,
  role: "user",
};

afterEach(() => {
  cleanup();
  window.history.replaceState(null, "", "/");
  vi.restoreAllMocks();
});

describe("AssistantHeaderSearch", () => {
  it("оставляет одну поисковую капсулу без отдельной кнопки-персонажа", () => {
    window.history.replaceState(null, "", "/giga");
    render(<AssistantHeaderSearch user={user} />);

    expect(screen.queryByRole("button", { name: "Открыть Giga" })).toBeNull();
    const focusButton = screen.getByRole("button", { name: "Перейти к поиску" });
    const input = screen.getByRole("textbox", { name: "Что хотите найти?" });
    fireEvent.click(focusButton);
    expect(document.activeElement).toBe(input);
    expect(screen.queryByText("На сайте")).toBeNull();
  });

  it("по Enter ищет в текущем контексте, а пустой запрос раскрывает Giga", () => {
    window.history.replaceState(null, "", "/printers");
    const searches: unknown[] = [];
    const opens: unknown[] = [];
    window.addEventListener(ASSISTANT_CONTEXT_SEARCH_EVENT, (event) => searches.push((event as CustomEvent).detail), { once: true });
    window.addEventListener(ASSISTANT_OPEN_EVENT, (event) => opens.push((event as CustomEvent).detail), { once: true });
    render(<AssistantHeaderSearch user={user} />);

    const form = screen.getByRole("search");
    const input = screen.getByRole("textbox", { name: "Какой принтер ищете?" });
    fireEvent.change(input, { target: { value: "CoreXY" } });
    expect(screen.getByRole("button", { name: /Найти «CoreXY»/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Продолжить в ГигаЧате/ })).toBeTruthy();
    fireEvent.submit(form);
    expect(searches).toEqual([{ query: "CoreXY", context: expect.objectContaining({ kind: "printers", pathname: "/printers" }) }]);

    fireEvent.change(input, { target: { value: "" } });
    fireEvent.submit(form);
    expect(opens).toEqual([{ query: "", context: expect.objectContaining({ kind: "printers", pathname: "/printers" }) }]);
  });

  it("меняет контекст в том же DOM-узле постоянной шапки", () => {
    window.history.replaceState(null, "", "/feed");
    const view = render(<AssistantHeaderSearch user={user} contextKey="feed" />);
    const form = screen.getByRole("search");
    expect(screen.getByRole("textbox", { name: "Что обсуждают?" })).toBeTruthy();

    window.history.replaceState(null, "", "/printers");
    view.rerender(<AssistantHeaderSearch user={user} contextKey="printers" />);

    expect(screen.getByRole("search")).toBe(form);
    expect(screen.getByRole("textbox", { name: "Какой принтер ищете?" })).toBeTruthy();
  });
});
