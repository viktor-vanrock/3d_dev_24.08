// Layer 5 — dependency-graph fitness rules (design.md §7.2, spec domain-boundaries → «Архитектурные
// проверки как CI-gate»). Complements layer 1 (ESLint) with graph-level guarantees ESLint can't express:
//   1. no circular dependencies anywhere in the migrated zone;
//   2. cross-domain edges in src/modules/** may land ONLY on another domain's public/ barrel;
//   3. shared _kernel / _boundaries must not depend on any concrete domain (keep the core acyclic-by-design).
//
// Scope: enforced on src/modules/** only (the strict zone); legacy src/** outside modules/ is not cruised
// here (design.md §7.3). Run: `pnpm --filter @portal/api depcruise` (wired as a CI gate, see package.json).

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: "no-circular",
      comment: "Circular dependencies make ownership and load order undefined — not allowed in migrated modules.",
      severity: "error",
      from: { path: "^src/modules" },
      // Type-only cycles have no runtime load edge and are permitted; runtime cycles remain errors.
      to: { circular: true, viaOnly: { dependencyTypesNot: ["type-only"] } },
    },
    {
      name: "cross-domain-only-via-public",
      comment:
        "A migrated domain may reach another domain ONLY through its public/ barrel. Importing another " +
        "domain's api/application/domain/infrastructure is a boundary violation (route via <other>/public).",
      severity: "error",
      from: {
        // any file inside a concrete domain (exclude shared _kernel/_boundaries)
        path: "^src/modules/(?!_)([^/]+)/",
        pathNot: "\\.test\\.ts$",
      },
      to: {
        // lands in a DIFFERENT concrete domain ...
        path: "^src/modules/(?!_)([^/]+)/",
        // ... but NOT that domain's public/ barrel, and NOT the same domain as the source
        pathNot: [
          "^src/modules/(?!_)[^/]+/public/", // public barrel is allowed
          "^src/modules/$1/", // same-domain ($1 = source domain capture) is allowed
        ],
      },
    },
    {
      name: "kernel-stays-independent",
      comment: "_kernel and _boundaries are shared primitives; they must not depend on any concrete domain.",
      severity: "error",
      from: { path: "^src/modules/_(kernel|boundaries)/" },
      to: { path: "^src/modules/(?!_)[^/]+/" },
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    tsConfig: { fileName: "tsconfig.json" },
    tsPreCompilationDeps: true,
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "require", "node", "default", "types"],
      extensions: [".ts", ".js", ".json"],
    },
    includeOnly: "^src/modules/",
    reporterOptions: {
      text: { highlightFocused: true },
    },
  },
};
