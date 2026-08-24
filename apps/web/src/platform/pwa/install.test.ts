import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { usePwaInstall } from "./install.ts";

function mockMatchMedia(standalone: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockReturnValue({ matches: standalone, media: "", addEventListener: vi.fn(), removeEventListener: vi.fn() }),
  );
}

class FakeBeforeInstallPromptEvent extends Event {
  outcome: "accepted" | "dismissed";
  constructor(outcome: "accepted" | "dismissed" = "accepted") {
    super("beforeinstallprompt", { cancelable: true });
    this.outcome = outcome;
  }
  prompt = vi.fn().mockResolvedValue(undefined);
  get userChoice() {
    return Promise.resolve({ outcome: this.outcome, platform: "android" });
  }
}

describe("usePwaInstall", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("canInstall становится true после beforeinstallprompt, preventDefault вызван", () => {
    mockMatchMedia(false);
    const { result } = renderHook(() => usePwaInstall());
    expect(result.current.canInstall).toBe(false);

    const event = new FakeBeforeInstallPromptEvent();
    const preventDefault = vi.spyOn(event, "preventDefault");
    act(() => {
      window.dispatchEvent(event);
    });

    expect(preventDefault).toHaveBeenCalled();
    expect(result.current.canInstall).toBe(true);
  });

  it("promptInstall дергает event.prompt() и возвращает outcome, дальше canInstall=false", async () => {
    mockMatchMedia(false);
    const { result } = renderHook(() => usePwaInstall());
    const event = new FakeBeforeInstallPromptEvent("accepted");
    act(() => {
      window.dispatchEvent(event);
    });

    let outcome: string | undefined;
    await act(async () => {
      outcome = await result.current.promptInstall();
    });

    expect(event.prompt).toHaveBeenCalledOnce();
    expect(outcome).toBe("accepted");
    expect(result.current.canInstall).toBe(false);
  });

  it("promptInstall без события — unavailable, ничего не падает", async () => {
    mockMatchMedia(false);
    const { result } = renderHook(() => usePwaInstall());
    const outcome = await result.current.promptInstall();
    expect(outcome).toBe("unavailable");
  });

  it("appinstalled — isStandalone=true и canInstall гаснет", () => {
    mockMatchMedia(false);
    const { result } = renderHook(() => usePwaInstall());
    act(() => {
      window.dispatchEvent(new FakeBeforeInstallPromptEvent());
    });
    expect(result.current.canInstall).toBe(true);

    act(() => {
      window.dispatchEvent(new Event("appinstalled"));
    });
    expect(result.current.isStandalone).toBe(true);
    expect(result.current.canInstall).toBe(false);
  });

  it("уже установлено (display-mode: standalone) — canInstall всегда false", () => {
    mockMatchMedia(true);
    const { result } = renderHook(() => usePwaInstall());
    expect(result.current.isStandalone).toBe(true);

    act(() => {
      window.dispatchEvent(new FakeBeforeInstallPromptEvent());
    });
    expect(result.current.canInstall).toBe(false);
  });
});
