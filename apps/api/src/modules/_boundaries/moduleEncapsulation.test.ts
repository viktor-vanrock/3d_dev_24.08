import { readdirSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Layer 4 — DI encapsulation arch-test (design.md §7.2, spec domain-boundaries → «Инкапсуляция домена
// на уровне импортов и DI»). A migrated domain's Nest module MUST export ONLY its public port(s); the
// repository (and other infrastructure providers) MUST stay private — physically un-injectable by other
// modules. This statically inspects each src/modules/<domain>/<domain>.module.ts and fails if a
// Repository-named provider appears in the module's `exports` array.
//
// Armed now (no modules yet) and enforces per-domain as <domain>.module.ts files land in phase 2/3. It
// deliberately parses the `exports: [...]` array textually rather than importing the module, so it works
// before @nestjs/* is installed and needs no DI container to run.

const MODULES_DIR = path.dirname(fileURLToPath(import.meta.url)).replace(/_boundaries$/, "");
const INFRA_DIRS = new Set(["_template", "_kernel", "_boundaries"]);

function moduleFiles(): { domain: string; file: string }[] {
  if (!existsSync(MODULES_DIR)) return [];
  const out: { domain: string; file: string }[] = [];
  for (const entry of readdirSync(MODULES_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory() || INFRA_DIRS.has(entry.name)) continue;
    const domainDir = path.join(MODULES_DIR, entry.name);
    for (const f of readdirSync(domainDir)) {
      if (f.endsWith(".module.ts")) out.push({ domain: entry.name, file: path.join(domainDir, f) });
    }
  }
  return out;
}

// Extract the identifiers listed in the module's `exports: [ ... ]` decorator array.
function parseExports(src: string): string[] {
  // Strip comments to avoid matching a commented-out exports block.
  const clean = src.replace(/\/\/[^\n]*/g, " ").replace(/\/\*[\s\S]*?\*\//g, " ");
  const m = /exports\s*:\s*\[([\s\S]*?)\]/.exec(clean);
  const body = m?.[1];
  if (!body) return [];
  return body
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

// A provider is a repository (infrastructure) if its identifier ends in Repository/Repo, or is a known
// infrastructure suffix. Public ports are the allowed exports (…Port / …PORT token / …Facade).
function looksLikeRepository(identifier: string): boolean {
  return /(Repository|Repo|Dao|DataSource|Pool)$/.test(identifier);
}

interface Violation {
  domain: string;
  file: string;
  exported: string;
}

function scan(): Violation[] {
  const violations: Violation[] = [];
  for (const { domain, file } of moduleFiles()) {
    const exported = parseExports(readFileSync(file, "utf8"));
    for (const id of exported) {
      if (looksLikeRepository(id)) {
        violations.push({ domain, file: path.relative(MODULES_DIR, file), exported: id });
      }
    }
  }
  return violations;
}

describe("module DI encapsulation (layer 4)", () => {
  const files = moduleFiles();

  it("machinery is wired (modules/ scanned, infra dirs skipped)", () => {
    expect(existsSync(MODULES_DIR)).toBe(true);
  });

  if (files.length === 0) {
    it("no Nest modules yet — gate armed, passes vacuously", () => {
      expect(files).toEqual([]);
    });
  }

  it("no module exports a repository/infrastructure provider", () => {
    const violations = scan();
    if (violations.length > 0) {
      const report = violations.map((v) => `  ${v.file}: exports '${v.exported}' — repositories are private; export only the public port`).join("\n");
      throw new Error(`${violations.length} DI-encapsulation violation(s):\n${report}`);
    }
    expect(violations).toEqual([]);
  });

  // Self-test of the detector so the gate is trustworthy before any real module exists.
  it("detector flags a repository in exports and passes a port-only exports list", () => {
    const bad = `@Module({ providers: [FooRepository, FooService], exports: [FooRepository] })`;
    const good = `@Module({ providers: [FooRepository, GetFooUseCase], exports: [FOO_PORT] })`;
    expect(parseExports(bad).some(looksLikeRepository)).toBe(true);
    expect(parseExports(good).some(looksLikeRepository)).toBe(false);
    expect(parseExports(good)).toEqual(["FOO_PORT"]);
  });
});
