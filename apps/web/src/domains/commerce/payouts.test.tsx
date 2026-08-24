import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PayoutsPanel } from "./payouts.tsx";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function stubFetch(routes: Record<string, unknown>) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      for (const [route, body] of Object.entries(routes)) {
        const [routeMethod, routePath] = route.split(" ");
        if (method === routeMethod && url.includes(routePath!)) {
          return new Response(JSON.stringify(body), { status: 200 });
        }
      }
      return new Response(JSON.stringify({}), { status: 404 });
    }),
  );
}

describe("баланс и выплаты автора", () => {
  it("показывает доступный баланс и баланс в холде", async () => {
    stubFetch({
      "GET /me/balance": { availableMinor: 15_000, holdMinor: 5_000, currency: "RUB" },
      "GET /sales": { sales: [] },
      "GET /payouts": { payouts: [] },
    });
    render(<PayoutsPanel />);
    expect(await screen.findByRole("heading", { name: "Баланс и выплаты" })).toBeTruthy();
    expect(screen.getByText("150 ₽")).toBeTruthy();
    expect(screen.getByText("50 ₽")).toBeTruthy();
  });

  it("показывает продажи и историю заявок на вывод", async () => {
    stubFetch({
      "GET /me/balance": { availableMinor: 0, holdMinor: 0, currency: "RUB" },
      "GET /sales": { sales: [{ id: "s1", model_id: "m1", model_title: "Держатель", seller_amount_minor: 12_000, currency: "RUB", paid_at: "2026-07-18T10:00:00Z" }] },
      "GET /payouts": { payouts: [{ id: "p1", amountMinor: 4_000, currency: "RUB", status: "pending", createdAt: "2026-07-18T10:00:00Z" }] },
    });
    render(<PayoutsPanel />);
    expect(await screen.findByText("Держатель")).toBeTruthy();
    expect(screen.getByText("120 ₽")).toBeTruthy();
    expect(screen.getByText("40 ₽")).toBeTruthy();
    expect(screen.getByText("Ожидает обработки")).toBeTruthy();
  });

  it("не рендерится, когда автору ещё нечего показать", async () => {
    stubFetch({
      "GET /me/balance": { availableMinor: 0, holdMinor: 0, currency: "RUB" },
      "GET /sales": { sales: [] },
      "GET /payouts": { payouts: [] },
    });
    const { container } = render(<PayoutsPanel />);
    await waitFor(() => expect(container.querySelector(".payoutsPanel")).toBeNull());
  });

  it("создаёт заявку на вывод и обновляет список", async () => {
    const user = userEvent.setup();
    let payoutsCalls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method ?? "GET";
        if (method === "GET" && url.includes("/me/balance")) {
          return new Response(JSON.stringify({ availableMinor: 10_000, holdMinor: 0, currency: "RUB" }), { status: 200 });
        }
        if (method === "GET" && url.includes("/sales")) {
          return new Response(JSON.stringify({ sales: [] }), { status: 200 });
        }
        if (method === "GET" && url.includes("/payouts")) {
          payoutsCalls += 1;
          const payouts = payoutsCalls > 1 ? [{ id: "p1", amountMinor: 4_000, currency: "RUB", status: "pending", createdAt: "2026-07-19T00:00:00Z" }] : [];
          return new Response(JSON.stringify({ payouts }), { status: 200 });
        }
        if (method === "POST" && url.includes("/payouts")) {
          return new Response(JSON.stringify({ id: "p1", amountMinor: 4_000, currency: "RUB", status: "pending", createdAt: "2026-07-19T00:00:00Z" }), { status: 201 });
        }
        return new Response(JSON.stringify({}), { status: 404 });
      }),
    );

    render(<PayoutsPanel />);
    await screen.findByPlaceholderText(/Сумма, ₽/);
    await user.type(screen.getByPlaceholderText(/Сумма, ₽/), "40");
    await user.type(screen.getByPlaceholderText("Номер карты"), "4444555566667777");
    await user.click(screen.getByRole("button", { name: "Запросить выплату" }));

    expect(await screen.findByText("Ожидает обработки")).toBeTruthy();
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining("/payouts"),
      expect.objectContaining({ method: "POST", body: JSON.stringify({ amountMinor: 4_000, requisites: { method: "card", value: "4444555566667777" } }) }),
    );
  });
});
