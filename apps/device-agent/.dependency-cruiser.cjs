/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: "no-production-cycles",
      comment: "Production layers must remain acyclic; type-only cycles have no runtime edge.",
      severity: "error",
      from: { path: "^src/", pathNot: ["\\.test\\.ts$", "^src/testing/"] },
      to: { circular: true, viaOnly: { dependencyTypesNot: ["type-only"] } },
    },
    {
      name: "core-stays-independent",
      comment: "Core identity, credentials and recovery code must not depend on transport or device adapters.",
      severity: "error",
      from: { path: "^src/(credentials|identity|recovery)\\.ts$" },
      to: { path: "^src/(connector|driver|relay)/" },
    },
    {
      name: "driver-stays-transport-independent",
      comment: "Printer drivers may use core code but must not depend on relay or connector orchestration.",
      severity: "error",
      from: { path: "^src/driver/" },
      to: { path: "^src/(connector|relay)/" },
    },
    {
      name: "relay-does-not-own-connectors",
      comment: "Relay transport may use the PrinterDriver port but must not import vendor connector internals.",
      severity: "error",
      from: { path: "^src/relay/" },
      to: { path: "^src/connector/" },
    },
    {
      name: "connector-registry-does-not-import-entrypoint",
      comment: "The connector registry is consumed by the composition root and must never depend on it.",
      severity: "error",
      from: { path: "^src/connector/(composition|registry)\\.ts$" },
      to: { path: "^src/main\\.ts$" },
    },
    {
      name: "production-registry-excludes-experimental-connectors",
      comment: "Experimental vendor connectors are excluded until their full lifecycle contract is production-ready.",
      severity: "error",
      from: { path: "^src/connector/(composition|registry)\\.ts$" },
      to: { path: "^src/connector/(creality|flsun|snapmaker)/" },
    },
    {
      name: "composition-root-does-not-bypass-connector-registry",
      comment: "The production entrypoint may consume driver ports but must not construct a concrete driver or vendor connector.",
      severity: "error",
      from: { path: "^src/main\\.ts$" },
      to: { path: "^src/(driver/moonraker|connector/(creality|flsun|moonraker|snapmaker))/" },
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
    includeOnly: "^src/",
    reporterOptions: {
      text: { highlightFocused: true },
    },
  },
};
