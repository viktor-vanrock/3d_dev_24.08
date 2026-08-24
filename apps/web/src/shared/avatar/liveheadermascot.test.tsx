import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { deterministicAvatarConfig } from "./avatar.tsx";
import { LiveHeaderMascot } from "./liveheadermascot.tsx";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("LiveHeaderMascot capability gate", () => {
  it("на touch/reduced-motion остаётся статичным портретом и не поднимает WebGL", () => {
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query.includes("reduced-motion"),
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
    const { container } = render(
      <LiveHeaderMascot
        config={deterministicAvatarConfig("maker")}
        snapshots={null}
        active={false}
        notificationCount={0}
        suspended={false}
      />,
    );
    expect(container.querySelector(".liveHeaderMascotFallback svg")).toBeTruthy();
    expect(container.querySelector("canvas")).toBeNull();
  });

  it("не создаёт canvas, пока конструктор персонажа активен", () => {
    vi.stubGlobal("matchMedia", () => ({
      matches: true,
      media: "(pointer: fine)",
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
    const { container } = render(
      <LiveHeaderMascot
        config={deterministicAvatarConfig("maker")}
        snapshots={null}
        active
        notificationCount={1}
        suspended
      />,
    );
    expect(container.querySelector(".liveHeaderMascotFallback svg")).toBeTruthy();
    expect(container.querySelector("canvas")).toBeNull();
  });
});
