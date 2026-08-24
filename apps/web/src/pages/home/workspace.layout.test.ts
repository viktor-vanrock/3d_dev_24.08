import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function source(relativeUrl: string) {
  return readFileSync(new URL(relativeUrl, import.meta.url), "utf8");
}

describe("рабочий wide-коридор каталогов", () => {
  it("подключён к каталогам принтеров, проектов и ленте", () => {
    expect(source("../../domains/printing/printers/printersscreen.tsx")).toContain('className="homeContent homeWorkspaceBody"');
    expect(source("../../domains/social/projects/projectspage.tsx")).toContain('className="projectsWideBody homeWorkspaceBody"');
    expect(source("../../domains/social/feed/feedscreen.tsx")).toContain('className="feedWideBody homeWorkspaceBody"');
  });

  it("совмещает границы контента с часами и капсулой, сохраняя mobile/TV safe-area", () => {
    const css = source("./home.shell.css");

    expect(css).toContain("--workspace-inline: calc(clamp(16px, 4vw, 48px) + 62px)");
    expect(css).toContain("width: calc(100% - var(--workspace-inline) - var(--workspace-inline))");
    expect(css).toContain("--workspace-inline: 16px");
    expect(css).toContain("width: calc(100% - var(--tv-safe-inline) - var(--tv-safe-inline))");
  });

  it("не применяет 10-foot размеры каталога к обычному широкому desktop", () => {
    const css = source("../../domains/printing/printers/printers.css");
    const tenFoot = css.slice(css.indexOf("/* --- 10-foot route tier"));

    expect(tenFoot).toContain('[data-input-mode="dpad"] .prnLayout');
    expect(tenFoot).toContain('[data-input-mode="dpad"] .prnGrid');
    expect(tenFoot).not.toMatch(/\n {2}\.prn(?:Layout|Grid|FacetSearch|Tile)\b/);
  });
});
