import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import version from "../../../../version.json";
import { DevBanner } from "./devbanner.tsx";

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

describe("DevBanner", () => {
  it("показывает компактный dev-бейдж с версией из version.json", () => {
    vi.stubEnv("VITE_DEV_BANNER", "1");
    render(<DevBanner />);

    expect(screen.getByText("DEV")).toBeTruthy();
    expect(screen.getByText("данные тестовые")).toBeTruthy();
    expect(screen.getByText(`v${version.year}.${version.release}.${version.minor}`)).toBeTruthy();
  });

  it("отсутствует вне dev-сборки", () => {
    vi.stubEnv("VITE_DEV_BANNER", "");
    const { container } = render(<DevBanner />);

    expect(container.firstChild).toBeNull();
  });

  it("использует контрастный текстовый токен для мелкой метки DEV", () => {
    const styles = readFileSync(resolve(process.cwd(), "src/dev/devbanner.css"), "utf8");
    const strongRule = styles.match(/\.devEnvironmentBadge strong\s*\{([^}]*)\}/)?.[1] ?? "";

    expect(strongRule).toContain("color: var(--text)");
    expect(strongRule).not.toContain("color: var(--accent-warn)");
  });
});
