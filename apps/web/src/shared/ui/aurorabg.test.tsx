import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { AuroraBackground } from "./aurorabg.tsx";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("AuroraBackground", () => {
  it("продолжает общую временную шкалу после route-перемонтирования", () => {
    const now = Date.now();
    const clock = vi.spyOn(Date, "now").mockReturnValue(now);
    const first = render(<AuroraBackground />);
    const firstPhase = Number.parseInt(
      first.container.querySelector<HTMLElement>(".aurorabg")?.style.getPropertyValue("--aurora-phase") ?? "0",
      10,
    );
    first.unmount();

    clock.mockReturnValue(now + 1_000);
    const second = render(<AuroraBackground />);
    const secondPhase = Number.parseInt(
      second.container.querySelector<HTMLElement>(".aurorabg")?.style.getPropertyValue("--aurora-phase") ?? "0",
      10,
    );

    expect(secondPhase - firstPhase).toBe(-1_000);
  });

  it("передаёт фазу всем трём blob-анимациям", () => {
    const styles = readFileSync(resolve(process.cwd(), "src/shared/ui/aurorabg.css"), "utf8");
    expect(styles).toMatch(/\.aurorabgBlob \{[\s\S]*?animation-delay: var\(--aurora-phase, 0ms\);/);
  });

  it("поддерживает постоянный app-shell класс и скрывает экранные дубликаты", () => {
    const view = render(<AuroraBackground className="appShellAurora" />);
    const styles = readFileSync(resolve(process.cwd(), "src/shared/ui/aurorabg.css"), "utf8");

    expect(view.container.querySelector(".aurorabg")?.classList.contains("appShellAurora")).toBe(true);
    expect(styles).toMatch(/\.appShell \.aurorabg:not\(\.appShellAurora\) \{[\s\S]*?display: none;/);
    expect(styles).toMatch(/\.appShellAurora \{[\s\S]*?view-transition-name: shell-aurora;/);
    expect(styles).toMatch(/::view-transition-group\(shell-aurora\),[\s\S]*?animation: none;/);
    expect(styles).toMatch(/::view-transition-old\(shell-aurora\) \{[\s\S]*?opacity: 0;/);
    expect(styles).toMatch(/::view-transition-new\(shell-aurora\) \{[\s\S]*?opacity: 1;/);
  });
});
