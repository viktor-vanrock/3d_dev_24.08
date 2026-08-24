import { existsSync, lstatSync, readdirSync, readFileSync } from "node:fs";
import { dirname, extname, relative, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const selfPath = "apps/relay/deploy/check-no-go-relay-residue.mjs";
const ignoredDirectoryNames = new Set([
  ".git",
  ".turbo",
  "coverage",
  "node_modules",
]);

const activeDocumentation = [
  "apps/relay/readme.md",
  "docs/api.public.md",
  "docs/architecture/printer.server.md",
  "docs/architecture/readme.md",
  "docs/architecture/relay.diagnostics.md",
  "docs/architecture/service.map.md",
  "docs/contracts/relay-command-result.v1.md",
  "docs/infra/dev.md",
  "docs/infra/domain.map.md",
  "docs/infra/firmware.pilot.md",
  "docs/infra/readme.md",
  "docs/infra/relay-qa-readiness.md",
];

// These files are evidence/baselines, not executable runtime, deploy configuration or current API documentation.
// The characterization pair is retained so Nest route-coverage checks can prove the legacy routes stay removed.
const explicitlyHistoricalFiles = new Set([
  "planning-base.md",
  "docs/base.md",
  "docs/epics/slicer.profiles.md",
  "docs/verification/mf-1293-relay-recovery.md",
  "apps/api/src/characterization/formallyRemovedRoutes.ts",
  "apps/api/src/characterization/routes.manifest.json",
]);

const canonicalLegacyNegativeTests = new Set([
  "packages/contracts/http/relay-internal.v1.ts",
  "packages/contracts/http/relay-internal.v1.test.ts",
]);

const failures = [];

function repositoryPath(absolutePath) {
  return relative(repositoryRoot, absolutePath).split("\\").join("/");
}

function walk(relativeRoot) {
  const absoluteRoot = resolve(repositoryRoot, relativeRoot);
  if (!existsSync(absoluteRoot)) return [];

  const result = [];
  for (const entry of readdirSync(absoluteRoot, { withFileTypes: true })) {
    if (entry.isDirectory() && ignoredDirectoryNames.has(entry.name)) continue;
    const absolutePath = resolve(absoluteRoot, entry.name);
    if (entry.isDirectory()) result.push(...walk(repositoryPath(absolutePath)));
    else if (entry.isFile() || entry.isSymbolicLink())
      result.push(absolutePath);
  }
  return result;
}

function rejectFile(relativePath, reason) {
  failures.push(`${relativePath}: ${reason}`);
}

function inspectRelayTree() {
  for (const absolutePath of walk("apps/relay")) {
    const relativePath = repositoryPath(absolutePath);
    if (relativePath === selfPath) continue;

    const segments = relativePath.split("/");
    const basename = segments.at(-1) ?? "";
    if (segments.includes("spike-lang"))
      rejectFile(relativePath, "language spike residue");
    if (
      extname(basename) === ".go" ||
      basename === "go.mod" ||
      basename === "go.sum"
    )
      rejectFile(relativePath, "Go source/module residue");
    if (
      basename === "Cargo.toml" ||
      basename === "Cargo.lock" ||
      extname(basename) === ".rs"
    )
      rejectFile(relativePath, "Rust spike residue");
    if (
      /^apps\/relay\/(?:bin|dist)\/(?:portal[.-])?relay(?:-dev)?$/u.test(
        relativePath,
      )
    )
      rejectFile(relativePath, "legacy relay binary");
  }
}

const activeConfigurationRoots = [
  ".gitverse",
  "deploy",
  "apps/relay/deploy",
  "apps/relay/scripts",
];
const activeConfigurationFiles = [
  ".gitignore",
  ".env.example",
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "turbo.json",
  "apps/relay/package.json",
];
const activeSourceRoots = [
  "apps/api/src",
  "apps/device-agent/src",
  "apps/relay/dist",
  "apps/relay/src",
  "packages/contracts",
];

const forbiddenActiveText = [
  {
    pattern: /\bgo\s+(?:build|install|run|test|vet)\b/iu,
    reason: "Go build/test command",
  },
  { pattern: /\bgofmt\b/iu, reason: "Go formatter command" },
  {
    pattern: /apps\/relay\/(?:cmd|internal|spike-lang)(?:\/|\b)/u,
    reason: "removed relay source path",
  },
  {
    pattern:
      /(?:^|[/\s])(?:go\.mod|go\.sum|Cargo\.toml|Cargo\.lock)(?:$|[/\s`'"),])/mu,
    reason: "removed language manifest",
  },
  {
    pattern: /(?:apps\/relay\/)?(?:bin|dist)\/relay(?:-dev)?(?:\s|$)/mu,
    reason: "legacy relay binary reference",
  },
  {
    pattern: /^Description=.*\bGo\b/mu,
    reason: "Go relay service description",
  },
  {
    pattern: /^ExecStart=(?!\/usr\/bin\/node\b).*apps\/relay/mu,
    reason: "non-Node relay service entrypoint",
  },
  {
    pattern:
      /^(?:export\s+)?(?:RELAY_INTERNAL_TOKEN|API_INTERNAL_URL|RELAY_HEALTH_PORT)\s*=/mu,
    reason: "active legacy relay environment assignment",
  },
];

const forbiddenActiveDocumentation = [
  ...forbiddenActiveText,
  { pattern: /\bGo[ -]relay\b/iu, reason: "Go identified as the active relay" },
  {
    pattern: /Relay\[\s*["']Go Relay["']\s*\]/u,
    reason: "Go relay architecture node",
  },
  {
    pattern: /\bGo-(?:бинар|сервис|реализац|рантайм)/iu,
    reason: "Go identified as the active relay",
  },
];

const legacyRoutePattern =
  /\/internal\/relay\/(?!v1\/)(?:session\/(?:open|heartbeat|close|print-result)|commands\/poll|commands\/(?:\{commandId\}|:commandId)\/result|transfers\/(?:\{transferId\}|:transferId)\/(?:metadata|progress)|command|files\/send)(?:\b|[/?}"'`])/u;

function inspectTextFile(relativePath, checks) {
  if (!existsSync(resolve(repositoryRoot, relativePath))) return;
  const text = readFileSync(resolve(repositoryRoot, relativePath), "utf8");
  for (const check of checks) {
    if (check.pattern.test(text)) rejectFile(relativePath, check.reason);
  }
}

function inspectActiveText() {
  const files = new Set(activeConfigurationFiles);
  for (const root of activeConfigurationRoots) {
    for (const absolutePath of walk(root))
      files.add(repositoryPath(absolutePath));
  }

  for (const relativePath of files) {
    if (
      relativePath === selfPath ||
      lstatSync(resolve(repositoryRoot, relativePath)).isSymbolicLink()
    )
      continue;
    inspectTextFile(relativePath, forbiddenActiveText);
  }

  for (const relativePath of activeDocumentation)
    inspectTextFile(relativePath, forbiddenActiveDocumentation);

  for (const root of activeSourceRoots) {
    for (const absolutePath of walk(root)) {
      const relativePath = repositoryPath(absolutePath);
      if (
        explicitlyHistoricalFiles.has(relativePath) ||
        canonicalLegacyNegativeTests.has(relativePath)
      )
        continue;
      if (!/\.(?:json|md|mjs|ts|tsx|yaml|yml)$/u.test(relativePath)) continue;
      const text = readFileSync(absolutePath, "utf8");
      if (legacyRoutePattern.test(text))
        rejectFile(
          relativePath,
          "active legacy unversioned relay route/contract",
        );
    }
  }
}

inspectRelayTree();
inspectActiveText();

if (failures.length > 0) {
  process.stderr.write(
    `no-go-relay-residue failed:\n${failures.map((failure) => `- ${failure}`).join("\n")}\n`,
  );
  process.exitCode = 1;
} else {
  process.stdout.write("no-go-relay-residue: OK\n");
  process.stdout.write(
    `historical allowlist: ${[...explicitlyHistoricalFiles].sort().join(", ")}\n`,
  );
  process.stdout.write(
    `canonical negative-test allowlist: ${[...canonicalLegacyNegativeTests].sort().join(", ")}\n`,
  );
}
