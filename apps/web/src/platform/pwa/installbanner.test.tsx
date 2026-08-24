import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CONSENT_VERSION, ConsentBanner } from "@platform/consent";
import { OverlayProvider } from "@platform/overlay";
import type { PwaInstallState } from "./install.ts";
import { InstallBanner } from "./installbanner.tsx";

const { installState, interactionSound } = vi.hoisted(() => ({
  installState: {
    canInstall: true,
    showIosInstructions: false,
    isStandalone: false,
    promptInstall: vi.fn<() => Promise<"accepted" | "dismissed" | "unavailable">>(),
  },
  interactionSound: {
    tick: vi.fn(),
    cta: vi.fn(),
    toggle: vi.fn(),
    nav: vi.fn(),
    confirm: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
    offline: vi.fn(),
  },
}));

vi.mock("./install.ts", async (importOriginal) => {
  const original = await importOriginal<typeof import("./install.ts")>();
  return { ...original, usePwaInstall: () => installState as PwaInstallState };
});

vi.mock("@platform/sound", () => ({ useInteractionSound: () => interactionSound }));

const CONSENT_KEY = "portal.consent.version";
const DISMISSED_KEY = "portal.pwa.installDismissedAt";

function renderBanner() {
  return render(
    <OverlayProvider>
      <InstallBanner />
    </OverlayProvider>,
  );
}

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem(CONSENT_KEY, CONSENT_VERSION);
  installState.canInstall = true;
  installState.showIosInstructions = false;
  installState.isStandalone = false;
  installState.promptInstall.mockReset().mockResolvedValue("accepted");
  Object.values(interactionSound).forEach((sound) => sound.mockClear());
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("InstallBanner", () => {
  it("показывает Android-копию только после успешного согласия без перезагрузки", async () => {
    const user = userEvent.setup();
    localStorage.removeItem(CONSENT_KEY);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 201 })));
    render(
      <OverlayProvider>
        <ConsentBanner />
        <InstallBanner />
      </OverlayProvider>,
    );

    expect(screen.queryByRole("region", { name: "Установка приложения" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Согласен" }));

    expect(await screen.findByRole("region", { name: "Установка приложения" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Установить" })).toBeTruthy();
    expect(screen.getByText("Быстрый доступ с домашнего экрана и офлайн-режим.")).toBeTruthy();
  });

  it("не показывается в standalone и во время 14-дневного cooldown", () => {
    installState.isStandalone = true;
    const { unmount } = renderBanner();
    expect(screen.queryByRole("region", { name: "Установка приложения" })).toBeNull();

    unmount();
    installState.isStandalone = false;
    localStorage.setItem(DISMISSED_KEY, new Date().toISOString());
    renderBanner();
    expect(screen.queryByRole("region", { name: "Установка приложения" })).toBeNull();
  });

  it("снова показывается после истечения cooldown", () => {
    localStorage.setItem(DISMISSED_KEY, new Date(Date.now() - 15 * 86_400_000).toISOString());
    renderBanner();
    expect(screen.getByRole("region", { name: "Установка приложения" })).toBeTruthy();
  });

  it.each(["accepted", "unavailable"] as const)("Android-исход %s скрывает баннер без cooldown", async (outcome) => {
    const user = userEvent.setup();
    installState.promptInstall.mockResolvedValue(outcome);
    renderBanner();

    await user.click(screen.getByRole("button", { name: "Установить" }));

    expect(installState.promptInstall).toHaveBeenCalledOnce();
    expect(interactionSound.cta).toHaveBeenCalledOnce();
    expect(screen.queryByRole("region", { name: "Установка приложения" })).toBeNull();
    expect(localStorage.getItem(DISMISSED_KEY)).toBeNull();
  });

  it("Android dismissed включает cooldown", async () => {
    const user = userEvent.setup();
    installState.promptInstall.mockResolvedValue("dismissed");
    renderBanner();

    await user.click(screen.getByRole("button", { name: "Установить" }));

    expect(screen.queryByRole("region", { name: "Установка приложения" })).toBeNull();
    expect(Number.isNaN(Date.parse(localStorage.getItem(DISMISSED_KEY) ?? ""))).toBe(false);
  });

  it("крестик скрывает баннер, включает cooldown и звучит tick", async () => {
    const user = userEvent.setup();
    renderBanner();

    await user.click(screen.getByRole("button", { name: "Закрыть" }));

    expect(interactionSound.tick).toHaveBeenCalledOnce();
    expect(interactionSound.cta).not.toHaveBeenCalled();
    expect(screen.queryByRole("region", { name: "Установка приложения" })).toBeNull();
    expect(Number.isNaN(Date.parse(localStorage.getItem(DISMISSED_KEY) ?? ""))).toBe(false);
  });

  it("iOS CTA открывает шторку с тремя шагами и сразу включает cooldown", async () => {
    const user = userEvent.setup();
    installState.canInstall = false;
    installState.showIosInstructions = true;
    renderBanner();

    expect(screen.getByText("Добавьте на экран «Домой» — как обычное приложение.")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Как установить" }));

    expect(interactionSound.cta).toHaveBeenCalledOnce();
    expect(screen.queryByRole("region", { name: "Установка приложения" })).toBeNull();
    expect(screen.getByRole("dialog", { name: "Установка на экран «Домой»" })).toBeTruthy();
    expect(screen.getByText(/Нажмите иконку «Поделиться»/)).toBeTruthy();
    expect(screen.getByText(/Прокрутите список вниз и выберите «На экран Домой»/)).toBeTruthy();
    expect(screen.getByText(/Нажмите «Добавить» в правом верхнем углу/)).toBeTruthy();
    expect(Number.isNaN(Date.parse(localStorage.getItem(DISMISSED_KEY) ?? ""))).toBe(false);
  });
});
