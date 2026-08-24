import { afterEach, describe, expect, it, vi } from "vitest";
import { ensurePersistentStorage, getStorageBudget } from "./storage.ts";

describe("ensurePersistentStorage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("navigator.storage отсутствует (Safari без API) — false, не падает", async () => {
    vi.stubGlobal("navigator", {});
    await expect(ensurePersistentStorage()).resolves.toBe(false);
  });

  it("уже persisted — не зовёт persist() повторно", async () => {
    const persist = vi.fn().mockResolvedValue(true);
    vi.stubGlobal("navigator", { storage: { persisted: vi.fn().mockResolvedValue(true), persist } });
    await expect(ensurePersistentStorage()).resolves.toBe(true);
    expect(persist).not.toHaveBeenCalled();
  });

  it("не persisted — зовёт persist() и возвращает результат", async () => {
    const persist = vi.fn().mockResolvedValue(true);
    vi.stubGlobal("navigator", { storage: { persisted: vi.fn().mockResolvedValue(false), persist } });
    await expect(ensurePersistentStorage()).resolves.toBe(true);
    expect(persist).toHaveBeenCalledOnce();
  });

  it("persist() бросает — fail-closed на false, не пробрасывает исключение", async () => {
    vi.stubGlobal("navigator", {
      storage: { persisted: vi.fn().mockResolvedValue(false), persist: vi.fn().mockRejectedValue(new Error("nope")) },
    });
    await expect(ensurePersistentStorage()).resolves.toBe(false);
  });
});

describe("getStorageBudget", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("estimate() недоступен — null", async () => {
    vi.stubGlobal("navigator", {});
    expect(await getStorageBudget()).toBeNull();
  });

  it("считает usageRatio из usage/quota", async () => {
    vi.stubGlobal("navigator", { storage: { estimate: vi.fn().mockResolvedValue({ usage: 50, quota: 200 }) } });
    expect(await getStorageBudget()).toEqual({ usageBytes: 50, quotaBytes: 200, usageRatio: 0.25 });
  });

  it("quota=0 — null, не делит на ноль", async () => {
    vi.stubGlobal("navigator", { storage: { estimate: vi.fn().mockResolvedValue({ usage: 0, quota: 0 }) } });
    expect(await getStorageBudget()).toBeNull();
  });
});
