import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CONSENT_VERSION } from "./consent.ts";

const STORAGE_KEY = "portal.consent.version";
const DISABLED_KEY = "umami.disabled";
const SCRIPT_ID = "umami-tracker-script";

async function loadModule() {
  vi.resetModules();
  return import("./umami.ts");
}

beforeEach(() => {
  localStorage.clear();
  document.getElementById(SCRIPT_ID)?.remove();
});

afterEach(() => {
  document.getElementById(SCRIPT_ID)?.remove();
  vi.unstubAllEnvs();
});

// MF-728: Umami-скрипт — fail-closed, тот же гейт согласия, что и остальная
// поведенческая аналитика (docs/design/consent.md, MF-609/610).
describe("initUmamiTracking", () => {
  it("без VITE_UMAMI_WEBSITE_ID — no-op, ничего не трогает даже без согласия", async () => {
    vi.stubEnv("VITE_UMAMI_WEBSITE_ID", "");
    const { initUmamiTracking } = await loadModule();
    initUmamiTracking();
    expect(document.getElementById(SCRIPT_ID)).toBeNull();
    expect(localStorage.getItem(DISABLED_KEY)).toBeNull();
  });

  it("id задан, согласия нет — скрипт не грузится, трекер помечен disabled", async () => {
    vi.stubEnv("VITE_UMAMI_WEBSITE_ID", "test-website-id");
    const { initUmamiTracking } = await loadModule();
    initUmamiTracking();
    expect(document.getElementById(SCRIPT_ID)).toBeNull();
    expect(localStorage.getItem(DISABLED_KEY)).toBe("true");
  });

  it("согласие уже есть при старте — скрипт грузится с нужным data-website-id", async () => {
    localStorage.setItem(STORAGE_KEY, CONSENT_VERSION);
    vi.stubEnv("VITE_UMAMI_WEBSITE_ID", "test-website-id");
    const { initUmamiTracking } = await loadModule();
    initUmamiTracking();
    const script = document.getElementById(SCRIPT_ID) as HTMLScriptElement | null;
    expect(script).not.toBeNull();
    expect(script!.src).toContain("/_a/script.js");
    expect(script!.getAttribute("data-website-id")).toBe("test-website-id");
    expect(localStorage.getItem(DISABLED_KEY)).toBeNull();
  });

  it("согласие дают после старта (баннер) — скрипт подгружается реактивно", async () => {
    vi.stubEnv("VITE_UMAMI_WEBSITE_ID", "test-website-id");
    const { initUmamiTracking } = await loadModule();
    initUmamiTracking();
    expect(document.getElementById(SCRIPT_ID)).toBeNull();

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 201 })),
    );
    const { submitConsent } = await import("./consent.ts");
    await submitConsent("granted");

    expect(document.getElementById(SCRIPT_ID)).not.toBeNull();
    expect(localStorage.getItem(DISABLED_KEY)).toBeNull();
    vi.unstubAllGlobals();
  });

  it("отзыв согласия после того, как скрипт уже загружен — сразу ставит disabled-флаг", async () => {
    localStorage.setItem(STORAGE_KEY, CONSENT_VERSION);
    vi.stubEnv("VITE_UMAMI_WEBSITE_ID", "test-website-id");
    const { initUmamiTracking } = await loadModule();
    initUmamiTracking();
    expect(document.getElementById(SCRIPT_ID)).not.toBeNull();

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 201 })),
    );
    const { submitConsent } = await import("./consent.ts");
    await submitConsent("revoked");

    expect(localStorage.getItem(DISABLED_KEY)).toBe("true");
    vi.unstubAllGlobals();
  });
});
