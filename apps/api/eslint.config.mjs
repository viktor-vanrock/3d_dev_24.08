import { base, tseslint } from "@portal/config/eslint.base.mjs";
import boundaries from "eslint-plugin-boundaries";
import ts from "typescript";

// Строгие type-aware правила раскатаны на ВЕСЬ пакет (задача 7.6, выполнена после удаления legacy
// Fastify в 7.4). До cutover правила жили в двухзонном split (`src/modules/**`+`src/nest/**`), потому
// что legacy `src/**` с 3432 инлайновыми SQL и Fastify-файлами не проходил strict. После 7.4 legacy
// почти не осталось (~107 .ts), src-нарушения починены точечно, и `recommendedTypeChecked` применяется
// глобально ко всему `src/**`. За основу набора — review-engine (соседний NestJS-проект). Наш tsconfig
// уже строже review-engine по noUncheckedIndexedAccess — его сохраняем.
//
// Тестовая зона (`**/*.test.ts`) держит те же type-aware правила, но с послаблениями под спай/фейки —
// тестовый код с моками естественно триггерит no-unsafe-*/require-await/unbound-method (решение
// оператора 2026-08-06: раскатать strict на весь api, тестам оставить прагматичные послабления).
const ALL_SRC = ["src/**/*.ts", "scripts/**/*.ts"];
const ALL_TESTS = ["src/**/*.test.ts", "scripts/**/*.test.ts"];
const HTTP_CONTRACTS = ["src/modules/*/public/**/*.ts", "src/modules/*/api/**/*controller.ts"];

const httpContractPlugin = {
  rules: {
    "no-unknown-promise": {
      meta: {
        type: "problem",
        docs: { description: "Require concrete request and Promise result types at HTTP contract boundaries" },
        schema: [],
        messages: {
          opaquePromise:
            "HTTP contract must return a concrete response type instead of an opaque Promise result (unknown/any/object/Record<string, unknown>/JsonValue/unresolved generic).",
          opaqueParameter:
            "HTTP {{decorator}} parameter '{{name}}' must use a concrete transport type instead of unknown/any/object/Record<string, unknown>/JsonValue/unresolved generic.",
        },
      },
      create(context) {
        const services = context.sourceCode.parserServices;
        const checker = services.program?.getTypeChecker();
        if (checker === undefined || services.esTreeNodeToTSNodeMap === undefined) return {};

        function typeName(type) {
          return type.aliasSymbol?.getName() ?? type.getSymbol()?.getName() ?? "";
        }

        function isOpaqueContractType(type, seen = new Set()) {
          if (seen.has(type)) return false;
          seen.add(type);

          const name = typeName(type);
          // Query executors are infrastructure seams exported through public barrels, not HTTP payloads.
          if (name === "QueryResult") return false;
          if (/Json(?:Value|Object)$/.test(name)) return true;
          if ((type.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown | ts.TypeFlags.TypeParameter | ts.TypeFlags.NonPrimitive)) !== 0) return true;
          if (type.isUnionOrIntersection()) return type.types.some((item) => isOpaqueContractType(item, seen));
          if ((type.flags & ts.TypeFlags.Object) === 0) return false;

          const properties = checker.getPropertiesOfType(type);
          const stringIndex = checker.getIndexTypeOfType(type, ts.IndexKind.String);
          if (stringIndex !== undefined && (stringIndex.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) !== 0) return true;
          if (properties.length === 0 && stringIndex === undefined) return true;

          const aliasArguments = type.aliasTypeArguments ?? [];
          const referenceArguments = ((type.objectFlags ?? 0) & ts.ObjectFlags.Reference) !== 0 ? checker.getTypeArguments(type) : [];
          return [...aliasArguments, ...referenceArguments].some((item) => isOpaqueContractType(item, seen));
        }

        function transportDecorator(parameter) {
          if (!ts.canHaveDecorators(parameter)) return undefined;
          for (const decorator of ts.getDecorators(parameter) ?? []) {
            const expression = ts.isCallExpression(decorator.expression) ? decorator.expression.expression : decorator.expression;
            if (ts.isIdentifier(expression) && ["Body", "Param", "Query"].includes(expression.text)) {
              return `@${expression.text}`;
            }
          }
          return undefined;
        }

        function checkMethod(node) {
          const tsNode = services.esTreeNodeToTSNodeMap.get(node);
          const signature = checker.getSignatureFromDeclaration(tsNode);
          if (signature === undefined) return;
          const returnType = checker.getReturnTypeOfSignature(signature);
          const resultType = checker.getPromisedTypeOfPromise(returnType);
          if (resultType !== undefined && isOpaqueContractType(resultType)) {
            context.report({ node, messageId: "opaquePromise" });
          }

          for (const parameter of tsNode.parameters ?? []) {
            const decorator = transportDecorator(parameter);
            if (decorator === undefined) continue;
            const parameterType = checker.getTypeAtLocation(parameter);
            if (!isOpaqueContractType(parameterType)) continue;
            context.report({
              node,
              messageId: "opaqueParameter",
              data: {
                decorator,
                name: ts.isIdentifier(parameter.name) ? parameter.name.text : "parameter",
              },
            });
          }
        }

        return {
          MethodDefinition: checkMethod,
          TSMethodSignature: checkMethod,
        };
      },
    },
  },
};

// Boundary-правила (eslint-plugin-boundaries) применимы ТОЛЬКО к мигрированным доменам
// `src/modules/**` — у legacy-кода нет доменной слоёной структуры {api,application,...}.

// Layer 1 — structural boundaries (design.md §7.2, spec domain-boundaries). Two zones: the strict
// `src/modules/**` zone (migrated domains) is held at ERROR level; legacy `src/**` outside modules/ is
// untouched (design.md §7.3 — error applies from the moment a domain migrates, not before). Moving a
// domain into src/modules/<domain>/ automatically subjects it to these rules.
//
// Element model (eslint-plugin-boundaries v7): each migrated domain is src/modules/<domain>/, split into
// layers {api, application, domain, infrastructure, public}. Cross-domain access is allowed ONLY into
// another domain's `public` barrel; a domain's own layers may depend inward per the onion order.
// Same-domain matching uses the v7 `{{from.domain}}` capture template.

const modulesElements = [
  // Shared, importable from anywhere in modules/.
  { type: "kernel", pattern: "src/modules/_kernel/**", partialMatch: false },
  { type: "boundaries-infra", pattern: "src/modules/_boundaries/**", partialMatch: false },
  // Per-domain layers. capture `domain` = folder name, so policies compare same-domain vs cross-domain.
  { type: "public", pattern: "src/modules/*/public/**", partialMatch: false, capture: ["domain"] },
  { type: "api", pattern: "src/modules/*/api/**", partialMatch: false, capture: ["domain"] },
  { type: "application", pattern: "src/modules/*/application/**", partialMatch: false, capture: ["domain"] },
  { type: "domain", pattern: "src/modules/*/domain/**", partialMatch: false, capture: ["domain"] },
  { type: "infrastructure", pattern: "src/modules/*/infrastructure/**", partialMatch: false, capture: ["domain"] },
  // The Nest module file (<domain>.module.ts) sits at the domain root; classified as `module-root` by a
  // folder-safe pattern (the domain dir) so no file-glob warning is emitted. It wires the domain's own
  // layers, so it is granted the same-domain inward allowances below.
  { type: "module-root", pattern: "src/modules/*", partialMatch: true, capture: ["domain"] },
];

// Same-domain target selector: the dependency's `domain` capture must equal the importer's.
const own = { domain: "{{from.domain}}" };

export default [
  ...base,

  // CommonJS tooling configs (.cjs) — declare the node/CommonJS globals so `module`/`require` are defined.
  {
    files: ["**/*.cjs"],
    languageOptions: { sourceType: "commonjs", globals: { module: "readonly", require: "readonly", __dirname: "readonly" } },
  },

  // ── Strict zone: src/modules/** ────────────────────────────────────────────────────────────────
  {
    files: ["src/modules/**/*.ts"],
    ignores: ["src/modules/**/*.test.ts"],
    plugins: { boundaries },
    settings: {
      "boundaries/dependency-nodes": ["import"],
      "boundaries/elements": modulesElements,
    },
    rules: {
      "boundaries/dependencies": [
        "error",
        {
          default: "disallow",
          policies: [
            // kernel + boundaries-infra: importable by anything in modules/ (no `from` filter = any source).
            { allow: { to: { element: { types: { anyOf: ["kernel", "boundaries-infra"] } } } } },

            // A domain's own layers, inward (onion), same-domain only via {{from.domain}}.
            { from: { element: { type: "api" } }, allow: { to: { element: { types: { anyOf: ["application", "domain", "public"] }, ...own } } } },
            { from: { element: { type: "application" } }, allow: { to: { element: { types: { anyOf: ["domain", "infrastructure", "public"] }, ...own } } } },
            { from: { element: { type: "infrastructure" } }, allow: { to: { element: { types: { anyOf: ["domain", "public"] }, ...own } } } },
            // The public barrel re-exports its own domain's types/ports.
            { from: { element: { type: "public" } }, allow: { to: { element: { types: { anyOf: ["domain", "application"] }, ...own } } } },
            { from: { element: { type: "domain" } }, allow: { to: { element: { type: "public", ...own } } } },
            { from: { element: { type: "module-root" } }, allow: { to: { element: { types: { anyOf: ["api", "application", "infrastructure", "public"] }, ...own } } } },

            // CROSS-DOMAIN: any layer may import ANOTHER domain, but ONLY its `public` barrel.
            {
              from: { element: { types: { anyOf: ["api", "application", "domain", "infrastructure", "module-root", "public"] } } },
              allow: { to: { element: { type: "public" } } },
            },
          ],
        },
      ],
      "boundaries/no-private": "off", // element-types governs cross-domain precisely.
    },
  },

  // ── Строгие type-aware правила: ВЕСЬ пакет src/** (задача 7.6) ──────────────────────────────────
  // За основу — review-engine (соседний NestJS-проект, максимально строгие правила). Type-aware набор
  // ловит класс runtime-багов, недоступных обычному линтеру: floating/misused promises, unsafe any.
  ...tseslint.configs.recommendedTypeChecked.map((cfg) => ({
    ...cfg,
    files: ALL_SRC,
  })),
  {
    files: ALL_SRC,
    languageOptions: {
      parserOptions: {
        // type-aware: подтягиваем TS-программу api (нужно для no-floating-promises и пр.).
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // async-безопасность (критично для Nest): незаваченный/неверно использованный промис = потерянная ошибка.
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",
      // граница типобезопасности.
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/ban-ts-comment": "error",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/no-unnecessary-type-assertion": "error",
      "@typescript-eslint/only-throw-error": "error",
      // no-unsafe-* оставлены на уровне recommendedTypeChecked (assignment/member/call/return = warn/error по
      // дефолту набора); no-explicit-any выше уже закрывает главный источник unsafe на новой границе.
    },
  },
  {
    // Operational scripts are composition roots. Cross-domain behavior must come from a
    // module's supported public surface; shared technical seams (db/git/storage) remain
    // available because they are explicitly owned by the operational inventory.
    files: ["scripts/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["../src/modules/*/api/**", "../src/modules/*/application/**", "../src/modules/*/domain/**", "../src/modules/*/infrastructure/**"],
              message: "Operational scripts must import cross-domain behavior through src/modules/<domain>/public.",
            },
          ],
        },
      ],
    },
  },
  {
    // `unknown` полезен внутри приложения, но непрозрачный корневой тип на HTTP-границе уничтожает
    // request/response schema. Проверяем фактически выведенный TypeScript type, поэтому gate ловит
    // не только буквальный Promise<unknown>, но и any/object/Record<string, unknown>/JsonValue,
    // unresolved generic и пустой object. Вложенные bounded JSONB/metrics maps разрешены: правило
    // запрещает только непрозрачный корень transport payload.
    files: HTTP_CONTRACTS,
    plugins: { "portal-contracts": httpContractPlugin },
    rules: {
      "portal-contracts/no-unknown-promise": "error",
    },
  },
  {
    // Тесты: те же type-aware правила, но послабления под спай/фейки. Тестовый код с моками
    // естественно триггерит unsafe-*/require-await/unbound-method — держим их off только для тестов,
    // продуктовый код под полным strict (решение оператора 2026-08-06).
    files: ALL_TESTS,
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
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
      "@typescript-eslint/consistent-type-imports": "off",
    },
  },
];
