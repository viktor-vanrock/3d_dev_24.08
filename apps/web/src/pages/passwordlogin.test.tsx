import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PasswordLogin } from "./passwordlogin.tsx";

const { passwordLoginMock } = vi.hoisted(() => ({ passwordLoginMock: vi.fn() }));

vi.mock("@domains/access", () => ({ passwordLogin: passwordLoginMock }));

beforeEach(() => passwordLoginMock.mockReset());
afterEach(cleanup);

describe("PasswordLogin", () => {
  it("submits credentials and completes the existing success flow", async () => {
    const onSuccess = vi.fn();
    passwordLoginMock.mockResolvedValue({ ok: true });
    render(<PasswordLogin onSuccess={onSuccess} />);

    fireEvent.change(screen.getByRole("textbox", { name: "Логин" }), { target: { value: "portal.admin" } });
    fireEvent.change(screen.getByLabelText("Пароль"), { target: { value: "secret" } });
    fireEvent.click(screen.getByRole("button", { name: "Войти" }));

    await waitFor(() => expect(passwordLoginMock).toHaveBeenCalledWith("portal.admin", "secret"));
    expect(onSuccess).toHaveBeenCalledOnce();
  });

  it.each([
    ["auth.unauthorized.v1", "Неверный логин или пароль"],
    ["http.client_error.v1", "Слишком много попыток, подождите"],
  ])("maps %s to a useful message", async (code, message) => {
    passwordLoginMock.mockResolvedValue({ ok: false, error: { code } });
    render(<PasswordLogin />);

    fireEvent.change(screen.getByRole("textbox", { name: "Логин" }), { target: { value: "user" } });
    fireEvent.change(screen.getByLabelText("Пароль"), { target: { value: "wrong" } });
    fireEvent.click(screen.getByRole("button", { name: "Войти" }));

    expect((await screen.findByRole("alert")).textContent).toBe(message);
  });

});
