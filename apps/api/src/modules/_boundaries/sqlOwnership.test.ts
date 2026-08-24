import { readdirSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { extractTableRefs, ownerOf, ownedTables, PUBLISHED_READ_VIEWS, type DomainTableManifest } from "./ownership.ts";

// Layer 2 CI gate (spec domain-boundaries → «Единственный владелец записи таблицы» / «Чтение чужих
// данных только через публичный контракт»). For every MIGRATED domain under src/modules/<domain>/, this
// scans the inline SQL and fails if the domain:
//   - WRITES a table it does not own (must go through the owner's public port), or
//   - READS a foreign physical table that is not its own and not a published read-view.
//
// Only domains that have moved into modules/ are enforced (design.md §7.3: error-level applies from the
// moment of migration; legacy src/<domain>/ is out of zone). Infra folders (_template, _kernel,
// _boundaries) are skipped. Today this asserts the machinery is wired and green with zero migrated
// domains; each domain migration (phase 3) adds itself under enforcement automatically.

const MODULES_DIR = path.dirname(fileURLToPath(import.meta.url)).replace(/_boundaries$/, "");
const NEST_INTEGRATION_DIR = path.resolve(MODULES_DIR, "../nest/integration");
const INFRA_DIRS = new Set(["_template", "_kernel", "_boundaries"]);

function migratedDomains(): string[] {
  if (!existsSync(MODULES_DIR)) return [];
  return readdirSync(MODULES_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !INFRA_DIRS.has(e.name))
    .map((e) => e.name)
    .sort();
}

function walkTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkTsFiles(full));
    else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) out.push(full);
  }
  return out;
}

// Load a domain's ownership manifest from infrastructure/<domain>.tables.ts by reading the exported
// `owns`/`readsForeignViews` arrays. We parse them statically (no import) so a domain need not be a Nest
// module yet. Falls back to the authoritative ownership map's ownedTables() if no manifest file exists.
function loadManifest(domain: string): DomainTableManifest {
  const infraDir = path.join(MODULES_DIR, domain, "infrastructure");
  const owns = new Set<string>(ownedTables(domain));
  const readsForeignViews = new Set<string>();
  if (existsSync(infraDir)) {
    for (const file of walkTsFiles(infraDir)) {
      if (!file.endsWith(".tables.ts")) continue;
      const src = readFileSync(file, "utf8");
      for (const key of ["owns", "readsForeignViews"] as const) {
        const block = new RegExp(`${key}\\s*:\\s*\\[([\\s\\S]*?)\\]`).exec(src);
        const body = block?.[1];
        if (!body) continue;
        for (const m of body.matchAll(/["'`]([a-z_][a-z0-9_]*)["'`]/gi)) {
          const name = m[1];
          if (name) (key === "owns" ? owns : readsForeignViews).add(name.toLowerCase());
        }
      }
    }
  }
  return { owns: [...owns], readsForeignViews: [...readsForeignViews] };
}

interface Violation {
  domain: string;
  file: string;
  table: string;
  kind: "read" | "write";
  reason: string;
}

function scanDomain(domain: string): Violation[] {
  const manifest = loadManifest(domain);
  const owns = new Set(manifest.owns);
  const allowedReadViews = new Set([...manifest.readsForeignViews, ...PUBLISHED_READ_VIEWS]);
  const violations: Violation[] = [];
  const domainDir = path.join(MODULES_DIR, domain);
  if (!existsSync(domainDir)) return violations;

  for (const file of walkTsFiles(domainDir)) {
    const src = readFileSync(file, "utf8");
    const rel = path.relative(MODULES_DIR, file);
    for (const ref of extractTableRefs(src)) {
      if (ref.kind === "write" && !owns.has(ref.table)) {
        violations.push({
          domain,
          file: rel,
          table: ref.table,
          kind: "write",
          reason: `writes '${ref.table}' owned by '${ownerOf(ref.table) ?? "?"}' — route through that domain's public port`,
        });
      }
      if (ref.kind === "read" && !owns.has(ref.table) && !allowedReadViews.has(ref.table)) {
        violations.push({
          domain,
          file: rel,
          table: ref.table,
          kind: "read",
          reason: `reads foreign physical table '${ref.table}' (owner '${ownerOf(ref.table) ?? "?"}') — use its published read-view`,
        });
      }
    }
  }
  return violations;
}

describe("SQL ownership boundary (layer 2)", () => {
  const domains = migratedDomains();

  it("machinery is wired (modules/ exists, infra dirs skipped)", () => {
    expect(existsSync(MODULES_DIR)).toBe(true);
    // _template is present but excluded from enforcement.
    expect(domains).not.toContain("_template");
  });

  if (domains.length === 0) {
    it("no migrated domains yet — gate is armed and passes vacuously", () => {
      expect(domains).toEqual([]);
    });
  }

  it.each(domains.map((d) => [d] as const))("migrated domain '%s' writes/reads only within its ownership manifest", (domain) => {
    const violations = scanDomain(domain);
    if (violations.length > 0) {
      const report = violations.map((v) => `  [${v.kind}] ${v.file}: ${v.reason}`).join("\n");
      throw new Error(`Domain '${domain}' has ${violations.length} boundary violation(s):\n${report}`);
    }
    expect(violations).toEqual([]);
  });

  it("keeps Nest integration adapters free of direct database access", () => {
    const violations = walkTsFiles(NEST_INTEGRATION_DIR).flatMap((file) => {
      const source = readFileSync(file, "utf8");
      const tableRefs = extractTableRefs(source);
      const directCalls = source.match(/\b(?:pool|client)\.(?:query|connect)\b/g) ?? [];
      if (tableRefs.length === 0 && directCalls.length === 0) return [];
      return [
        {
          file: path.relative(NEST_INTEGRATION_DIR, file),
          tables: [...new Set(tableRefs.map((ref) => ref.table))],
          directCalls: directCalls.length,
        },
      ];
    });
    if (violations.length > 0) {
      const report = violations.map((violation) => `  ${violation.file}: tables=[${violation.tables.join(", ")}], direct DB calls=${violation.directCalls}`).join("\n");
      throw new Error(`Nest integration adapters contain database access:\n${report}`);
    }
    expect(violations).toEqual([]);
  });
});
