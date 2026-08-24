import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EmailLogin } from "./emaillogin.tsx";

const { startEmailAuthMock, verifyEmailAuthMock } = vi.hoisted(() => ({
  startEmailAuthMock: vi.fn(),
  verifyEmailAuthMock: vi.fn(),
}));

vi.mock("@domains/access/session.ts", () => ({
  EMAIL_DOMAINS: ["sberbank.ru", "sberdevices.ru"],
  startEmailAuth: startEmailAuthMock,
  verifyEmailAuth: verifyEmailAuthMock,
}));

beforeEach(() => {
  startEmailAuthMock.mockReset();
  verifyEmailAuthMock.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("EmailLogin", () => {
  it("связывает видимый label с полем и оставляет локальную часть гибкой по ширине", () => {
    render(<EmailLogin />);

    const input = screen.getByRole("textbox", { name: "Рабочая почта" });
    expect(input.getAttribute("inputmode")).toBe("email");
    expect(input.closest(".emailLoginField")).toBeTruthy();
    expect(screen.getByRole("combobox", { name: "Домен почты" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Получить код" }).classList.contains("emailLoginSubmit")).toBe(true);
  });

  it("объявляет ошибку, сохраняет ввод и снимает устаревшую ошибку при исправлении", async () => {
    startEmailAuthMock.mockResolvedValue({ ok: false, error: "Проверьте адрес почты" });
    render(<EmailLogin />);

    const input = screen.getByRole("textbox", { name: "Рабочая почта" });
    fireEvent.change(input, { target: { value: "ivan.petrv" } });
    fireEvent.click(screen.getByRole("button", { name: "Получить код" }));

    expect((await screen.findByRole("alert")).textContent).toContain("Проверьте адрес почты");
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect((input as HTMLInputElement).value).toBe("ivan.petrv");

    fireEvent.change(input, { target: { value: "ivan.petrov" } });
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    expect(input.getAttribute("aria-invalid")).toBeNull();
    expect((input as HTMLInputElement).value).toBe("ivan.petrov");
  });
});
