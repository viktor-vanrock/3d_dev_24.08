import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fetchPushPreferences,
  fetchVapidPublicKey,
  isPushSupported,
  isSubscribed,
  resubscribeIfStale,
  setPushPreference,
  subscribeToPush,
  unsubscribeFromPush,
} from "./push.ts";

function mockFetch(routes: Record<string, { status?: number; body?: unknown }>) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const match = Object.entries(routes).find(([candidate]) => url.includes(candidate));
      if (!match) return new Response(null, { status: 404 });
      const { status = 200, body } = match[1];
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

function mockServiceWorker(opts: {
  getSubscription?: PushSubscription | null;
  subscribeReturns?: PushSubscription;
}) {
  const pushManager = {
    getSubscription: vi.fn().mockResolvedValue(opts.getSubscription ?? null),
    subscribe: vi.fn().mockResolvedValue(opts.subscribeReturns ?? fakeSubscription()),
  };
  vi.stubGlobal("navigator", {
    ...navigator,
    serviceWorker: { ready: Promise.resolve({ pushManager }) },
  });
  vi.stubGlobal("PushManager", class {});
  return pushManager;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("isPushSupported", () => {
  it("false без PushManager в window", () => {
    expect(isPushSupported()).toBe(false);
  });

  it("true когда serviceWorker и PushManager есть", () => {
    mockServiceWorker({});
    expect(isPushSupported()).toBe(true);
  });
});

describe("fetchVapidPublicKey", () => {
  it("возвращает ключ с бэкенда", async () => {
    mockFetch({ "/push/vapid-public-key": { body: { public_key: "BKey123" } } });
    expect(await fetchVapidPublicKey()).toBe("BKey123");
  });

  it("null — VAPID не сконфигурирован на окружении, не падает", async () => {
    mockFetch({ "/push/vapid-public-key": { body: { public_key: null } } });
    expect(await fetchVapidPublicKey()).toBeNull();
  });

  it("401/сеть недоступна — null, не бросает", async () => {
    mockFetch({ "/push/vapid-public-key": { status: 401 } });
    expect(await fetchVapidPublicKey()).toBeNull();
  });
});

describe("fetchPushPreferences", () => {
  it("возвращает preferences с бэкенда", async () => {
    mockFetch({ "/push/preferences": { body: { preferences: [{ type: "like", enabled: false }] } } });
    expect(await fetchPushPreferences()).toEqual([{ type: "like", enabled: false }]);
  });

  it("ошибка запроса — фоллбэк все 6 типов enabled:true", async () => {
    mockFetch({ "/push/preferences": { status: 500 } });
    const prefs = await fetchPushPreferences();
    expect(prefs).toHaveLength(6);
    expect(prefs.every((p) => p.enabled)).toBe(true);
  });
});

describe("setPushPreference", () => {
  it("PUT и true при совпадении ответа", async () => {
    mockFetch({ "/push/preferences": { body: { type: "sale", enabled: false } } });
    expect(await setPushPreference("sale", false)).toBe(true);
  });

  it("false при ошибке", async () => {
    mockFetch({ "/push/preferences": { status: 422 } });
    expect(await setPushPreference("sale", false)).toBe(false);
  });
});

describe("subscribeToPush", () => {
  it("unsupported без PushManager", async () => {
    expect(await subscribeToPush()).toBe("unsupported");
  });

  it("no_vapid когда бэкенд не отдал ключ", async () => {
    mockServiceWorker({});
    mockFetch({ "/push/vapid-public-key": { body: { public_key: null } } });
    expect(await subscribeToPush()).toBe("no_vapid");
  });

  it("permission_denied — не подписывает", async () => {
    mockServiceWorker({});
    mockFetch({ "/push/vapid-public-key": { body: { public_key: "BKey123" } } });
    vi.stubGlobal("Notification", { requestPermission: vi.fn().mockResolvedValue("denied"), permission: "default" });
    expect(await subscribeToPush()).toBe("permission_denied");
  });

  it("subscribed — permission granted, новая подписка отправлена на бэкенд", async () => {
    const pushManager = mockServiceWorker({});
    mockFetch({
      "/push/vapid-public-key": { body: { public_key: "BKey123" } },
      "/push/subscriptions": { body: { ok: true } },
    });
    vi.stubGlobal("Notification", { requestPermission: vi.fn().mockResolvedValue("granted"), permission: "default" });

    expect(await subscribeToPush()).toBe("subscribed");
    expect(pushManager.subscribe).toHaveBeenCalledOnce();
  });

  it("уже есть подписка — переиспользует, не зовёт subscribe() снова", async () => {
    const pushManager = mockServiceWorker({ getSubscription: fakeSubscription() });
    mockFetch({
      "/push/vapid-public-key": { body: { public_key: "BKey123" } },
      "/push/subscriptions": { body: { ok: true } },
    });
    vi.stubGlobal("Notification", { requestPermission: vi.fn().mockResolvedValue("granted"), permission: "default" });

    expect(await subscribeToPush()).toBe("subscribed");
    expect(pushManager.subscribe).not.toHaveBeenCalled();
  });
});

describe("isSubscribed", () => {
  it("false без PushManager в window", async () => {
    expect(await isSubscribed()).toBe(false);
  });

  it("false — поддержан, но активной подписки нет", async () => {
    mockServiceWorker({ getSubscription: null });
    expect(await isSubscribed()).toBe(false);
  });

  it("true — есть активная подписка", async () => {
    mockServiceWorker({ getSubscription: fakeSubscription() });
    expect(await isSubscribed()).toBe(true);
  });
});

describe("unsubscribeFromPush", () => {
  it("отписывает локально и на бэкенде", async () => {
    const subscription = fakeSubscription();
    mockServiceWorker({ getSubscription: subscription });
    mockFetch({ "/push/subscriptions": { body: { ok: true } } });

    expect(await unsubscribeFromPush()).toBe(true);
    expect(subscription.unsubscribe).toHaveBeenCalledOnce();
  });

  it("нет активной подписки — no-op true", async () => {
    mockServiceWorker({ getSubscription: null });
    expect(await unsubscribeFromPush()).toBe(true);
  });
});

describe("resubscribeIfStale", () => {
  it("permission не granted — ничего не делает", async () => {
    const pushManager = mockServiceWorker({});
    vi.stubGlobal("Notification", { permission: "default" });
    await resubscribeIfStale();
    expect(pushManager.subscribe).not.toHaveBeenCalled();
  });

  it("permission granted, endpoint протух (подписки нет) — молча реподписывает", async () => {
    const pushManager = mockServiceWorker({ getSubscription: null });
    mockFetch({
      "/push/vapid-public-key": { body: { public_key: "BKey123" } },
      "/push/subscriptions": { body: { ok: true } },
    });
    vi.stubGlobal("Notification", { permission: "granted" });

    await resubscribeIfStale();
    expect(pushManager.subscribe).toHaveBeenCalledOnce();
  });

  it("permission granted, подписка уже жива — не зовёт subscribe(), только дозаписывает", async () => {
    const pushManager = mockServiceWorker({ getSubscription: fakeSubscription() });
    mockFetch({
      "/push/vapid-public-key": { body: { public_key: "BKey123" } },
      "/push/subscriptions": { body: { ok: true } },
    });
    vi.stubGlobal("Notification", { permission: "granted" });

    await resubscribeIfStale();
    expect(pushManager.subscribe).not.toHaveBeenCalled();
  });
});
