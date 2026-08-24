import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PurchaseAction, PurchasesPanel, formatMoney } from "./purchases.tsx";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("покупка модели", () => {
  it("форматирует цену из минорных единиц", () => {
    expect(formatMoney(15_000, "RUB")).toBe("150 ₽");
  });

  it("создаёт покупку и переводит на защищённую страницу провайдера", async () => {
    const user = userEvent.setup();
    const assign = vi.fn();
    vi.stubGlobal("location", { ...window.location, assign });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ purchaseId: "p1", confirmationUrl: "https://yookassa.ru/pay/p1" }), { status: 201 })));

    render(<PurchaseAction modelId="m1" priceMinor={15_000} currency="RUB" purchased={false} onDownload={() => {}} />);
    await user.click(screen.getByRole("button", { name: "Купить за 150 ₽" }));

    expect(fetch).toHaveBeenCalledWith(expect.stringContaining("/purchases"), expect.objectContaining({ method: "POST" }));
    expect(assign).toHaveBeenCalledWith("https://yookassa.ru/pay/p1");
  });

  it("после покупки показывает скачивание вместо повторной оплаты", () => {
    render(<PurchaseAction modelId="m1" priceMinor={15_000} currency="RUB" purchased onDownload={() => {}} />);
    expect(screen.getByRole("button", { name: "Скачать 3MF" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Купить/ })).toBeNull();
  });
});

describe("история покупок", () => {
  it("показывает модель, сумму и статус", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ purchases: [{ id: "p1", model_id: "m1", model_title: "Держатель", price_minor: 15_000, currency: "RUB", status: "paid", created_at: "2026-07-18T10:00:00Z" }] }), { status: 200 })));
    render(<PurchasesPanel />);
    expect(await screen.findByRole("heading", { name: "Покупки" })).toBeTruthy();
    expect(screen.getByText("Держатель")).toBeTruthy();
    expect(screen.getByText("Оплачено")).toBeTruthy();
    expect(screen.getByText("150 ₽")).toBeTruthy();
  });
});
