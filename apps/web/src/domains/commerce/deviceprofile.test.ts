import { afterEach, describe, expect, it, vi } from "vitest";
import { isMobileViewerProfile } from "./deviceprofile.ts";

function mockMatchMedia(matches: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockImplementation((query: string) => ({
      matches,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("isMobileViewerProfile", () => {
  it("грубый указатель без hover — мобильный профиль", () => {
    mockMatchMedia(true);
    expect(isMobileViewerProfile()).toBe(true);
  });

  it("точный указатель с hover (десктоп/мышь) — не мобильный профиль", () => {
    mockMatchMedia(false);
    expect(isMobileViewerProfile()).toBe(false);
  });
});
