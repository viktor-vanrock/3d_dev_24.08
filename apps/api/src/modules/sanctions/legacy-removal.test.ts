import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const apiSourceRoot = resolve(fileURLToPath(new URL("../../", import.meta.url)));

function sourceFiles(directory: string): readonly string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(path) : entry.name.endsWith(".ts") ? [path] : [];
  });
}

function sourceText(paths: readonly string[]): string {
  return paths
    .filter((path) => !path.endsWith("/legacy-removal.test.ts") && !path.endsWith("/legacy-migration.integration.test.ts"))
    .map((path) => readFileSync(path, "utf8"))
    .join("\n");
}

describe("sanctions legacy cutover", () => {
  const source = sourceText(sourceFiles(apiSourceRoot));

  it("removes the legacy ban mutation surfaces", () => {
    expect(source).not.toMatch(new RegExp(`ban${"User"}`));
    expect(source).not.toMatch(new RegExp(`ban${"OwnedUser"}`));
    expect(source).not.toMatch(/\/users\/.+\/ban/);
  });

  it("removes banned as a runtime profile status", () => {
    expect(source).not.toMatch(/status\s*=\s*['"]banned['"]/);
    const profileSource = sourceText(sourceFiles(resolve(apiSourceRoot, "modules/profile")));
    expect(profileSource).not.toMatch(/['"]banned['"]/);
  });
});
