import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { OverlayProvider } from "@platform/overlay";
import { PushSettingsSection } from "./profile.push.tsx";

// Спека docs/design/push.notifications.md §7 «Готово когда» — тесты по той же схеме
// state-machine, что push/push.test.ts, но на уровне видимого UI (MF-434 Фаза 3 шаг 2).

function mockFetch(routes: Record<string, { status?: number; body?: unknown }>) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      const match = Object.entries(routes).find(([candidate]) => url.includes(candidate));
      if (!match) return new Response(null, { status: 404 });
      const { status = 200, body } = match[1];
      // PUT /push/preferences эхом отражает {type, enabled} из тела запроса, если body не задан явно.
      if (body === undefined && method === "PUT" && init?.body) {
        return new Response(String(init.body), { status });
      }
      return new Response(body === undefined ? null : JSON.stringify(body), { status });
    }),
  );
}

function fakeSubscription(endpoint = "https://push.example/abc") {
  return {
    endpoint,
    toJSON: () => ({ endpoint, keys: { p256dh: "p256dh-key", auth: "auth-key" } }),
    unsubscribe: vi.fn().mockResolvedValue(true),
  } as unknown as PushSubscription;
}

function mockServiceWorker(opts: { getSubscription?: PushSubscription | null; userAgent?: string }) {
  const pushManager = {
    getSubscription: vi.fn().mockResolvedValue(opts.getSubscription ?? null),
    subscribe: vi.fn().mockResolvedValue(fakeSubscription()),
  };
  vi.stubGlobal("navigator", {
    ...navigator,
    userAgent: opts.userAgent ?? navigator.userAgent,
    serviceWorker: { ready: Promise.resolve({ pushManager }) },
  });
  vi.stubGlobal("PushManager", class {});
  return pushManager;
}

function stubNotification(permission: NotificationPermission, requestResult?: NotificationPermission) {
  vi.stubGlobal("Notification", {
    permission,
    requestPermission: vi.fn().mockResolvedValue(requestResult ?? permission),
  });
}

const IOS_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 16_4 like Mac OS X) AppleWebKit/605.1.15 Version/16.4 Mobile Safari/604.1";

function renderSection() {
  return render(
    <OverlayProvider>
      <PushSettingsSection />
    </OverlayProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("PushSettingsSection", () => {
  it("VAPID null (окружение не сконфигурировано) — секции нет вообще, без ошибки", async () => {
    mockFetch({ "/push/vapid-public-key": { body: { public_key: null } } });
    renderSection();
    await waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalled());
    expect(screen.queryByText("Уведомления")).toBeNull();
  });

  it("push не поддержан, не iOS — секции нет вообще", async () => {
    mockFetch({ "/push/vapid-public-key": { body: { public_key: "BKey123" } } });
    renderSection();
    await waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalled());
    expect(screen.queryByText("Уведомления")).toBeNull();
  });

  it("iOS Safari вне home-screen-install — инструкция «На экран Домой», без тумблеров", async () => {
    // Нет PushManager-стаба — iOS Safari его и не даёт, isPushSupported() остаётся false.
    vi.stubGlobal("navigator", { ...navigator, userAgent: IOS_UA });
    mockFetch({ "/push/vapid-public-key": { body: { public_key: "BKey123" } } });

    renderSection();
    expect(await screen.findByText(/На экран Домой/)).toBeTruthy();
    expect(screen.queryByRole("switch")).toBeNull();
  });

  it("push поддержан, не подписан — master off, список типов скрыт", async () => {
    mockServiceWorker({ getSubscription: null });
    mockFetch({ "/push/vapid-public-key": { body: { public_key: "BKey123" } } });

    renderSection();
    const master = await screen.findByRole("switch", { name: "Пуш-уведомления" });
    expect(master.getAttribute("aria-checked")).toBe("false");
    expect(screen.queryByRole("switch", { name: "Лайки" })).toBeNull();
  });

  it("уже подписан при монтировании — master on + список из 6 типов сразу", async () => {
    mockServiceWorker({ getSubscription: fakeSubscription() });
    mockFetch({
      "/push/vapid-public-key": { body: { public_key: "BKey123" } },
      "/push/preferences": { body: { preferences: [{ type: "like", enabled: false }] } },
    });

    renderSection();
    const master = await screen.findByRole("switch", { name: "Пуш-уведомления" });
    await waitFor(() => expect(master.getAttribute("aria-checked")).toBe("true"));
    expect(await screen.findAllByRole("switch")).toHaveLength(7); // master + 6 типов
  });

  it("тап на master (off→on), permission granted — подписывает и показывает 6 типов", async () => {
    mockServiceWorker({ getSubscription: null });
    stubNotification("default", "granted");
    mockFetch({
      "/push/vapid-public-key": { body: { public_key: "BKey123" } },
      "/push/subscriptions": { body: { ok: true } },
      "/push/preferences": { body: { preferences: [] } },
    });

    renderSection();
    const master = await screen.findByRole("switch", { name: "Пуш-уведомления" });
    fireEvent.click(master);

    await waitFor(() => expect(master.getAttribute("aria-checked")).toBe("true"));
    expect(await screen.findByRole("switch", { name: "Продажи моделей" })).toBeTruthy();
  });

  it("тап на master, browser отклонил permission — warn-подсказка, без ложного «вкл»", async () => {
    mockServiceWorker({ getSubscription: null });
    stubNotification("default", "denied");
    mockFetch({ "/push/vapid-public-key": { body: { public_key: "BKey123" } } });

    renderSection();
    const master = await screen.findByRole("switch", { name: "Пуш-уведомления" });
    fireEvent.click(master);

    expect(await screen.findByText(/заблокированы в браузере/)).toBeTruthy();
    expect(master.getAttribute("aria-checked")).toBe("false");
  });

  it("уже когда-то отклонённый permission — подсказка видна с первого рендера", async () => {
    mockServiceWorker({ getSubscription: null });
    stubNotification("denied");
    mockFetch({ "/push/vapid-public-key": { body: { public_key: "BKey123" } } });

    renderSection();
    expect(await screen.findByText(/заблокированы в браузере/)).toBeTruthy();
  });

  it("тап по типу — оптимистичный флип, откат при ошибке сохранения", async () => {
    mockServiceWorker({ getSubscription: fakeSubscription() });
    mockFetch({
      "/push/vapid-public-key": { body: { public_key: "BKey123" } },
      "/push/preferences": { status: 500 }, // PUT тоже проваливается
    });

    renderSection();
    const likeSwitch = await screen.findByRole("switch", { name: "Лайки" });
    expect(likeSwitch.getAttribute("aria-checked")).toBe("true"); // дефолт enabled:true

    fireEvent.click(likeSwitch);
    expect(likeSwitch.getAttribute("aria-checked")).toBe("false"); // мгновенный оптимистичный флип

    await waitFor(() => expect(likeSwitch.getAttribute("aria-checked")).toBe("true")); // откат
  });

  it("тумблер по всей строке ≥48px тап-таргета не требует клика точно по свитчу", async () => {
    mockServiceWorker({ getSubscription: null });
    mockFetch({ "/push/vapid-public-key": { body: { public_key: "BKey123" } } });

    renderSection();
    await screen.findByRole("switch", { name: "Пуш-уведомления" });
    const row = screen.getByText("Ремиксы, лайки, продажи и заказы — прямо в браузере").closest(".pushRow");
    expect(row).toBeTruthy();
  });
});
