import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ConsentBanner } from "./consentbanner.tsx";
import { CONSENT_VERSION } from "./consent.ts";

const STORAGE_KEY = "portal.consent.version";

function mockConsentFetch(status: number) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify({ ok: status < 400 }), { status })),
  );
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

// MF-610: баннер согласия — fail-closed на UX (без клика не скрывается), одна кнопка.
describe("ConsentBanner", () => {
  it("аноним без согласия видит баннер с единственной кнопкой «Согласен»", () => {
    render(<ConsentBanner />);
    expect(screen.getByText(/поведенческих данных/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Согласен" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Отклонить/ })).toBeNull();
  });

  it("не усиливает компактное действие декоративной стрелкой", () => {
    render(<ConsentBanner />);
    expect(screen.getByRole("button", { name: "Согласен" }).querySelector("svg")).toBeNull();
  });

  it("уже согласившийся текущей версии — баннер не рендерится", () => {
    localStorage.setItem(STORAGE_KEY, CONSENT_VERSION);
    render(<ConsentBanner />);
    expect(screen.queryByText(/поведенческих данных/)).toBeNull();
  });

  it("клик «Согласен» бьёт POST /consent {action:granted} и скрывает баннер на успех", async () => {
    const user = userEvent.setup();
    mockConsentFetch(201);
    render(<ConsentBanner />);
    await user.click(screen.getByRole("button", { name: "Согласен" }));

    await vi.waitFor(() => {
      expect(screen.queryByText(/поведенческих данных/)).toBeNull();
    });
    expect(localStorage.getItem(STORAGE_KEY)).toBe(CONSENT_VERSION);
    const options = vi.mocked(fetch).mock.calls[0]?.[1];
    expect(JSON.parse(String(options?.body))).toEqual({ action: "granted", version: CONSENT_VERSION });
  });

  it("сетевая/серверная ошибка — fail-closed, баннер остаётся видимым", async () => {
    const user = userEvent.setup();
    mockConsentFetch(500);
    render(<ConsentBanner />);
    await user.click(screen.getByRole("button", { name: "Согласен" }));

    await vi.waitFor(() => {
      expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    });
    expect(screen.getByText(/поведенческих данных/)).toBeTruthy();
  });

  it("после успешного ответа закрывает баннер даже до следующего чтения store", async () => {
    const user = userEvent.setup();
    mockConsentFetch(201);
    render(<ConsentBanner />);
    await user.click(screen.getByRole("button", { name: "Согласен" }));

    await vi.waitFor(() => {
      expect(screen.queryByRole("button", { name: /Согласен/ })).toBeNull();
    });
  });
});
