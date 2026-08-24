import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

const scriptsDir = dirname(fileURLToPath(import.meta.url));
const apiDir = dirname(scriptsDir);
const repoDir = join(apiDir, "../..");

interface InventoryEntry {
  readonly file: string;
  readonly lifecycle: string;
  readonly owner: string;
  readonly invocations: readonly string[];
  readonly requiredEnvironment: readonly string[];
  readonly dataTargets: readonly string[];
  readonly sideEffects: string;
  readonly safetyMode: string;
  readonly verification: string;
}

interface Inventory {
  readonly liveState: string;
  readonly sharedTechnicalImports: readonly string[];
  readonly retired: readonly { readonly file: string; readonly reason: string; readonly replacement: string; readonly liveCleanup: string }[];
  readonly entries: readonly InventoryEntry[];
}

function filesBelow(root: string, directory = root): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    return statSync(path).isDirectory() ? filesBelow(root, path) : [relative(root, path)];
  });
}

function inventory(): Inventory {
  return JSON.parse(readFileSync(join(scriptsDir, "operational-entrypoints.inventory.json"), "utf8")) as Inventory;
}

describe("operational entrypoint inventory", () => {
  it("accounts for every file and records complete lifecycle metadata", () => {
    const value = inventory();
    expect(value.liveState).toBe("live-unverified: no deployed environment");
    expect(value.entries.map(({ file }) => file).sort()).toEqual(filesBelow(scriptsDir).sort());
    for (const retired of value.retired) {
      expect(filesBelow(scriptsDir)).not.toContain(retired.file);
      expect(retired.reason).not.toBe("");
      expect(retired.replacement).not.toBe("");
      expect(retired.liveCleanup).not.toBe("");
    }

    for (const entry of value.entries) {
      expect(entry.lifecycle).not.toBe("");
      expect(entry.owner).not.toBe("");
      expect(entry.invocations.length).toBeGreaterThan(0);
      expect(entry.requiredEnvironment.length).toBeGreaterThan(0);
      expect(entry.dataTargets.length).toBeGreaterThan(0);
      expect(entry.sideEffects).not.toBe("");
      expect(entry.safetyMode).not.toBe("");
      expect(entry.verification).not.toBe("");
    }
  });

  it("resolves every script path declared by an API package command", () => {
    const packageJson = readFileSync(join(apiDir, "package.json"), "utf8");
    const declaredPaths = [...packageJson.matchAll(/scripts\/[A-Za-z0-9_./-]+\.(?:ts|sh)/g)].map(([path]) => path.replace(/^scripts\//, ""));
    const actualPaths = new Set(filesBelow(scriptsDir));
    for (const path of declaredPaths) expect(actualPaths.has(path), `missing package entrypoint scripts/${path}`).toBe(true);
  });

  it("resolves every package command declared by an API deployment service", () => {
    const packageJson = JSON.parse(readFileSync(join(apiDir, "package.json"), "utf8")) as { readonly scripts: Readonly<Record<string, string>> };
    const deployDir = join(apiDir, "deploy");
    for (const file of filesBelow(deployDir).filter((path) => path.endsWith(".service"))) {
      const unit = readFileSync(join(deployDir, file), "utf8");
      const commands = [...unit.matchAll(/ExecStart=.*pnpm run ([^\s]+)/g)].map((match) => match[1]);
      expect(commands.length, `${file} has no pnpm package command`).toBeGreaterThan(0);
      for (const command of commands) expect(packageJson.scripts[command!], `${file} references missing package command ${command}`).toBeDefined();
      expect(unit).toMatch(/^Type=oneshot$/m);
      expect(unit).toMatch(/^WorkingDirectory=\/home\/plag\/portal\.ru\/apps\/api$/m);
      expect(unit).toMatch(/^EnvironmentFile=\/home\/plag\/portal\.api\.env$/m);
    }
  });

  it("pairs every API timer with a persistent bounded oneshot service", () => {
    const deployDir = join(apiDir, "deploy");
    for (const timerFile of filesBelow(deployDir).filter((path) => path.endsWith(".timer"))) {
      const serviceFile = timerFile.replace(/\.timer$/, ".service");
      expect(filesBelow(deployDir), `${timerFile} has no matching service`).toContain(serviceFile);
      const timer = readFileSync(join(deployDir, timerFile), "utf8");
      const service = readFileSync(join(deployDir, serviceFile), "utf8");
      expect(timer).toMatch(/^OnCalendar=\S.+$/m);
      expect(timer).toMatch(/^RandomizedDelaySec=\d+$/m);
      expect(timer).toMatch(/^Persistent=true$/m);
      expect(timer).toMatch(/^WantedBy=timers\.target$/m);
      expect(service).toMatch(/^Type=oneshot$/m);
    }
  });

  it("keeps the repository CI validation path wired to API lint and typecheck", () => {
    const rootPackage = JSON.parse(readFileSync(join(repoDir, "package.json"), "utf8")) as { readonly scripts: Readonly<Record<string, string>> };
    const apiPackage = JSON.parse(readFileSync(join(apiDir, "package.json"), "utf8")) as { readonly scripts: Readonly<Record<string, string>> };
    const workflow = readFileSync(join(repoDir, ".gitverse/workflows/ci.yaml"), "utf8");

    expect(rootPackage.scripts.typecheck).toContain("turbo run typecheck");
    expect(rootPackage.scripts.lint).toContain("turbo run lint");
    expect(apiPackage.scripts.typecheck).toContain("pnpm run typecheck:scripts");
    expect(apiPackage.scripts["typecheck:scripts"]).toContain("scripts/tsconfig.json");
    expect(apiPackage.scripts.lint).toBe("eslint .");
    expect(workflow).toContain("run: pnpm typecheck");
    expect(workflow).toContain("run: pnpm lint");
  });

  it("rejects private module imports and unsafe asynchronous handling through normal API lint config", async () => {
    const eslint = new ESLint({ cwd: apiDir });
    const [privateImport] = await eslint.lintText('import "../src/modules/catalog/infrastructure/private.ts";\n', {
      filePath: join(scriptsDir, "operational-entrypoints.test.ts"),
    });
    const [floatingPromise] = await eslint.lintText("async function pending(): Promise<void> {}\npending();\n", {
      filePath: join(scriptsDir, "operational-entrypoints.test.ts"),
    });

    expect(privateImport?.messages.map(({ ruleId }) => ruleId)).toContain("no-restricted-imports");
    expect(floatingPromise?.messages.map(({ ruleId }) => ruleId)).toContain("@typescript-eslint/no-floating-promises");
  }, 15_000);

  it("allows source imports only through module public surfaces or inventoried technical seams", () => {
    const allowedTechnicalImports = new Set(inventory().sharedTechnicalImports);
    for (const file of filesBelow(scriptsDir).filter((path) => path.endsWith(".ts"))) {
      const source = readFileSync(join(scriptsDir, file), "utf8");
      for (const match of source.matchAll(/from\s+["'](\.\.\/src\/[^"']+)["']/g)) {
        const importPath = match[1]!;
        const isPublicModuleSurface = /^\.\.\/src\/modules\/[^/]+\/public\//.test(importPath);
        expect(isPublicModuleSurface || allowedTechnicalImports.has(importPath), `${file} uses uninventoried source import ${importPath}`).toBe(true);
      }
    }
  });

  it("rejects an unresolved script import through the scripts TypeScript project", () => {
    const fixtureDir = mkdtempSync(join(tmpdir(), "portal-operational-typecheck-"));
    try {
      writeFileSync(join(fixtureDir, "unresolved.ts"), 'import { missing } from "./definitely-missing-operational-module.ts";\nvoid missing;\n');
      writeFileSync(
        join(fixtureDir, "tsconfig.json"),
        `${JSON.stringify({ extends: join(scriptsDir, "tsconfig.json"), compilerOptions: { rootDir: ".", types: [] }, include: ["unresolved.ts"] })}\n`,
      );
      const require = createRequire(import.meta.url);
      const tsc = require.resolve("typescript/bin/tsc");
      const result = spawnSync(process.execPath, [tsc, "-p", join(fixtureDir, "tsconfig.json"), "--pretty", "false"], { encoding: "utf8" });
      expect(result.status).not.toBe(0);
      expect(`${result.stdout}${result.stderr}`).toContain("TS2307");
    } finally {
      rmSync(fixtureDir, { recursive: true, force: true });
    }
  });
});
