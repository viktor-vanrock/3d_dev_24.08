import { readdirSync, readFileSync, existsSync, lstatSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";

// «Нет Fastify-мусора после переноса на Nest» — механический гейт (spec api-runtime → «После cutover
// Fastify отсутствует»; exit-gate 8.5; операторское требование 2026-08-05). Выражает чистоту машинно, а
// не чеклистом.
//
// Два режима:
//  • ARMED (по умолчанию, во время миграции): мигрированная зона `src/modules/**` и Nest-обвязка
//    `src/nest/**` НЕ должны содержать ни одного Fastify-импорта/типа. Каждый домен, переехавший в
//    modules/, обязан быть Fastify-free — «перенёс, но притащил Fastify-хвост» падает сразу.
//  • STRICT (NO_FASTIFY_STRICT=1, на cutover — задача 7.4): проверяется ВЕСЬ пакет — 0 Fastify-импортов/
//    типов, 0 прямых Fastify-пакетов в manifest/lockfile/installed state, default scripts запускают Nest,
//    а source/dist legacy-entrypoints и доменные routes.ts удалены. Красный гейт блокирует cutover.

const API_ROOT = path.dirname(fileURLToPath(import.meta.url)).replace(/\/src\/modules\/_boundaries$/, "");
const WORKSPACE_ROOT = path.resolve(API_ROOT, "../..");
const SRC = path.join(API_ROOT, "src");
const STRICT = process.env.NO_FASTIFY_STRICT === "1";

// Fastify-маркеры (замерено 2026-08-05): 5 пакетов + импорт-специфаеры + типы в сигнатурах.
const FASTIFY_PACKAGES = ["fastify", "fastify-plugin", "@fastify/cookie", "@fastify/cors", "@fastify/multipart"];
const FASTIFY_IMPORT_RE = /from\s+["'](fastify|fastify-plugin|@fastify\/[a-z-]+)["']/;
const FASTIFY_TYPE_RE = /\bFastify(Instance|Request|Reply|PluginAsync|PluginCallback|ServerOptions|Schema|BaseLogger|Error)\b/;
// Легаси Fastify-entrypoint/инфра, которые обязаны исчезнуть на cutover.
const LEGACY_ENTRYPOINTS = ["main.ts", "server.ts", "routeLoader.ts", "cors.ts"];
const LEGACY_BUILD_STEMS = ["main", "server", "routeLoader", "cors"];
const LEGACY_BUILD_EXTENSIONS = [".js", ".js.map", ".d.ts", ".d.ts.map"];

interface PackageManifest {
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
}

interface LockfileImporter {
  dependencies?: Record<string, unknown>;
  devDependencies?: Record<string, unknown>;
  optionalDependencies?: Record<string, unknown>;
}

interface PnpmLockfile {
  importers?: Record<string, LockfileImporter>;
  packages?: Record<string, unknown>;
  snapshots?: Record<string, unknown>;
}

function readManifest(): PackageManifest {
  return JSON.parse(readFileSync(path.join(API_ROOT, "package.json"), "utf8")) as PackageManifest;
}

function existsOrIsSymlink(target: string): boolean {
  try {
    lstatSync(target);
    return true;
  } catch {
    return false;
  }
}

function walkTs(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walkTs(full));
    else if (e.name.endsWith(".ts")) out.push(full);
  }
  return out;
}

interface Hit {
  file: string;
  line: number;
  kind: "import" | "type";
  text: string;
}

function scanFastify(files: string[]): Hit[] {
  const hits: Hit[] = [];
  for (const file of files) {
    const rel = path.relative(API_ROOT, file);
    const lines = readFileSync(file, "utf8").split("\n");
    lines.forEach((raw, i) => {
      if (FASTIFY_IMPORT_RE.test(raw)) hits.push({ file: rel, line: i + 1, kind: "import", text: raw.trim() });
      else if (FASTIFY_TYPE_RE.test(raw)) hits.push({ file: rel, line: i + 1, kind: "type", text: raw.trim() });
    });
  }
  return hits;
}

function report(hits: Hit[]): string {
  const shown = hits.slice(0, 25).map((h) => `  ${h.file}:${h.line} [${h.kind}] ${h.text.slice(0, 90)}`);
  const more = hits.length > 25 ? `\n  … и ещё ${hits.length - 25}` : "";
  return shown.join("\n") + more;
}

describe("no-fastify-residue gate", () => {
  it(`machinery wired (mode: ${STRICT ? "STRICT/cutover" : "ARMED/migration"})`, () => {
    expect(existsSync(SRC)).toBe(true);
  });

  // ── ARMED: migrated zone must be Fastify-free from day one ──────────────────────────────────────
  it("migrated zone src/modules/** has no Fastify import or type", () => {
    const hits = scanFastify(walkTs(path.join(SRC, "modules")));
    if (hits.length) throw new Error(`Fastify-хвост в мигрированной зоне modules/ (${hits.length}):\n${report(hits)}`);
    expect(hits).toEqual([]);
  });

  it("Nest layer src/nest/** has no Fastify import or type", () => {
    const hits = scanFastify(walkTs(path.join(SRC, "nest")));
    if (hits.length) throw new Error(`Fastify-хвост в Nest-обвязке nest/ (${hits.length}):\n${report(hits)}`);
    expect(hits).toEqual([]);
  });

  // ── STRICT (cutover 7.4): the WHOLE package must be Fastify-free ─────────────────────────────────
  const strictIt = STRICT ? it : it.skip;

  strictIt("[strict] no Fastify import/type anywhere in src/**", () => {
    const hits = scanFastify(walkTs(SRC));
    if (hits.length) throw new Error(`Fastify-остатки в пакете (${hits.length}):\n${report(hits)}`);
    expect(hits).toEqual([]);
  });

  strictIt("[strict] no Fastify packages in package.json", () => {
    const pkg = readManifest();
    const present = FASTIFY_PACKAGES.filter((p) => pkg.dependencies?.[p] || pkg.devDependencies?.[p] || pkg.peerDependencies?.[p]);
    if (present.length) throw new Error(`Fastify-пакеты ещё в package.json: ${present.join(", ")}`);
    expect(present).toEqual([]);
  });

  strictIt("[strict] lockfile has no direct API dependency or resolved Fastify install graph", () => {
    const lockfile = parseYaml(readFileSync(path.join(WORKSPACE_ROOT, "pnpm-lock.yaml"), "utf8")) as PnpmLockfile;
    const importer = lockfile.importers?.["apps/api"];
    if (!importer) throw new Error("apps/api importer отсутствует в pnpm-lock.yaml");
    const direct = FASTIFY_PACKAGES.filter((p) => importer.dependencies?.[p] || importer.devDependencies?.[p] || importer.optionalDependencies?.[p]);
    const resolvedKeys = [...Object.keys(lockfile.packages ?? {}), ...Object.keys(lockfile.snapshots ?? {})];
    const resolved = resolvedKeys.filter((key) => FASTIFY_PACKAGES.some((packageName) => key === packageName || key.startsWith(`${packageName}@`)));
    if (direct.length || resolved.length) {
      throw new Error(`Fastify остался в lockfile: direct=[${direct.join(", ")}], resolved=[${resolved.join(", ")}]`);
    }
    expect({ direct, resolved }).toEqual({ direct: [], resolved: [] });
  });

  strictIt("[strict] default dev/start scripts launch Nest entrypoints", () => {
    const scripts = readManifest().scripts ?? {};
    expect(scripts.dev, "default dev script должен завершаться запуском src/nest/main.ts").toMatch(/(?:^|&&\s*)node --loader ts-node\/esm --watch src\/nest\/main\.ts$/);
    expect(scripts.start, "default start script должен запускать dist/nest/main.js").toBe("node dist/nest/main.js");
  });

  strictIt("[strict] legacy Fastify entrypoints are deleted", () => {
    const left = LEGACY_ENTRYPOINTS.filter((f) => existsSync(path.join(SRC, f)));
    if (left.length) throw new Error(`Легаси Fastify-entrypoint ещё на месте: ${left.map((f) => `src/${f}`).join(", ")}`);
    expect(left).toEqual([]);
  });

  strictIt("[strict] no compiled legacy Fastify entrypoints remain in dist/", () => {
    const left = LEGACY_BUILD_STEMS.flatMap((stem) => LEGACY_BUILD_EXTENSIONS.map((extension) => path.join(API_ROOT, "dist", `${stem}${extension}`))).filter(existsOrIsSymlink);
    if (left.length) {
      throw new Error(`Скомпилированные legacy entrypoint ещё в dist/: ${left.map((f) => path.relative(API_ROOT, f)).join(", ")}`);
    }
    expect(left).toEqual([]);
  });

  strictIt("[strict] clean installed state has no direct Fastify packages", () => {
    const left = FASTIFY_PACKAGES.map((packageName) => path.join(API_ROOT, "node_modules", packageName)).filter(existsOrIsSymlink);
    if (left.length) {
      throw new Error(`Fastify-пакеты ещё установлены как прямые зависимости apps/api: ${left.map((f) => path.relative(API_ROOT, f)).join(", ")}`);
    }
    expect(left).toEqual([]);
  });

  strictIt("[strict] no legacy domain routes.ts outside modules/", () => {
    const orphan: string[] = [];
    for (const e of readdirSync(SRC, { withFileTypes: true })) {
      if (!e.isDirectory() || e.name === "modules" || e.name === "nest") continue;
      if (existsSync(path.join(SRC, e.name, "routes.ts"))) orphan.push(`src/${e.name}/routes.ts`);
    }
    if (orphan.length) throw new Error(`Легаси Fastify-домены не мигрированы/не удалены:\n  ${orphan.join("\n  ")}`);
    expect(orphan).toEqual([]);
  });
});
