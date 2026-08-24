import { base, tseslint } from "@portal/config/eslint.base.mjs";
import boundaries from "eslint-plugin-boundaries";

const ALL_SRC = ["src/**/*.ts"];
const ALL_TESTS = ["src/**/*.test.ts"];
const PRODUCTION_SRC = ["src/**/*.ts"];
const PRODUCTION_IGNORES = ["src/**/*.test.ts", "src/testing/**"];

const agentElements = [
  { type: "connector", pattern: "src/connector", partialMatch: true },
  { type: "relay", pattern: "src/relay", partialMatch: true },
  { type: "driver", pattern: "src/driver", partialMatch: true },
  { type: "testing", pattern: "src/testing", partialMatch: true },
  { type: "core", pattern: "src", partialMatch: true },
];

export default [
  { ignores: [".release-dist/**", "dist/**"] },
  ...base,

  {
    files: PRODUCTION_SRC,
    ignores: PRODUCTION_IGNORES,
    linterOptions: {
      noInlineConfig: true,
      reportUnusedDisableDirectives: "error",
    },
  },

  // Production code uses the API's type-aware linting baseline, strengthened with the
  // strictTypeChecked preset. Tests keep type-aware analysis but receive narrow mock-only
  // relaxations below.
  ...tseslint.configs.strictTypeChecked.map((config) => ({
    ...config,
    files: PRODUCTION_SRC,
    ignores: PRODUCTION_IGNORES,
  })),
  ...tseslint.configs.recommendedTypeChecked.map((config) => ({
    ...config,
    files: ALL_TESTS,
  })),
  {
    files: ALL_SRC,
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/ban-ts-comment": "error",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/consistent-type-exports": "error",
      "@typescript-eslint/no-import-type-side-effects": "error",
      "@typescript-eslint/no-unnecessary-type-assertion": "error",
      "@typescript-eslint/only-throw-error": "error",
      "@typescript-eslint/restrict-template-expressions": ["error", { allowNumber: true }],
    },
  },
  {
    files: PRODUCTION_SRC,
    ignores: PRODUCTION_IGNORES,
    rules: {
      "no-warning-comments": ["error", { terms: ["eslint-disable", "eslint-enable"], location: "anywhere" }],
      "no-restricted-syntax": [
        "error",
        {
          selector: "TSAsExpression > TSAsExpression",
          message: "Unchecked double casts are forbidden in device-agent production code.",
        },
      ],
    },
  },
  {
    files: ["src/connector/**/*.ts"],
    ignores: ["src/**/*.test.ts", "src/connector/config.ts", "src/connector/common/tokenStore.ts"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "TSAsExpression > TSAsExpression",
          message: "Unchecked double casts are forbidden in device-agent production code.",
        },
        {
          selector: "CallExpression[callee.object.name='JSON'][callee.property.name='parse']",
          message: "Parse connector JSON only through the runtime validator in connector/config.ts.",
        },
      ],
    },
  },
  {
    files: PRODUCTION_SRC,
    ignores: PRODUCTION_IGNORES,
    plugins: { boundaries },
    settings: {
      "boundaries/dependency-nodes": ["import"],
      "boundaries/elements": agentElements,
      "boundaries/files": [{ category: "composition", pattern: "src/main.ts" }],
    },
    rules: {
      "boundaries/no-unknown-files": "error",
      "boundaries/dependencies": [
        "error",
        {
          default: "disallow",
          policies: [
            {
              from: { file: { categories: "composition" } },
              allow: { to: { element: { types: { anyOf: ["connector", "relay", "driver", "core"] } } } },
            },
            {
              from: { element: { type: "connector" } },
              allow: { to: { element: { types: { anyOf: ["connector", "driver", "core"] } } } },
            },
            {
              from: { element: { type: "relay" } },
              allow: { to: { element: { types: { anyOf: ["relay", "driver", "core"] } } } },
            },
            {
              from: { element: { type: "driver" } },
              allow: { to: { element: { types: { anyOf: ["driver", "core"] } } } },
            },
            {
              from: { element: { type: "core" } },
              allow: { to: { element: { type: "core" } } },
            },
          ],
        },
      ],
    },
  },
  {
    files: ALL_TESTS,
    rules: {
      "@typescript-eslint/only-throw-error": "off",
      "@typescript-eslint/unbound-method": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-return": "off",
      "@typescript-eslint/require-await": "off",
      "@typescript-eslint/no-base-to-string": "off",
      "@typescript-eslint/no-unnecessary-type-assertion": "off",
    },
  },
  {
    files: ["deploy/**/*.mjs"],
    languageOptions: {
      globals: { process: "readonly", URL: "readonly", console: "readonly", Buffer: "readonly" },
    },
  },
  {
    files: ["**/*.cjs"],
    languageOptions: {
      sourceType: "commonjs",
      globals: { module: "readonly", require: "readonly", __dirname: "readonly" },
    },
  },
];
