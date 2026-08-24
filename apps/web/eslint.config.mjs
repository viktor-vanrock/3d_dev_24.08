import { base } from "@portal/config/eslint.base.mjs";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import boundaries from "eslint-plugin-boundaries";

export default [
  // Исключаем сгенерированные файлы из проверки
  {
    ignores: [
      "dist",
      "coverage", 
      "node_modules",
      // Автогенерат из swagger — не редактировать руками
      "src/shared/api/generated.ts",
    ],
  },

  ...base,
  {
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": "warn",

      // — Базовые правила качества кода (активны сейчас) —

      // Запрет console.log в продакшн-коде (warn и error разрешены)
      "no-console": ["error", { allow: ["warn", "error"] }],

      // Только === вместо == (кроме сравнения с null)
      "eqeqeq": ["error", "always", { null: "ignore" }],

      // Запрет дублирующих импортов из одного модуля
      "no-duplicate-imports": ["error", { includeExports: true }],


      // — Строгие TypeScript-правила (раскомментировать отдельной задачей) —
      // Требуют parserOptions.projectService: true (ESLint читает tsconfig)
      // После включения вылезут десятки ошибок по всему проекту

      // Требует явно писать import type { Foo } для типов (не import { Foo })
      // "@typescript-eslint/consistent-type-imports": [
      //   "error",
      //   { fixStyle: "inline-type-imports", prefer: "type-imports" },
      // ],

      // Требует явно писать тип возврата у функций верхнего уровня
      // "@typescript-eslint/explicit-function-return-type": [
      //   "error",
      //   { allowExpressions: true, allowTypedFunctionExpressions: true },
      // ],

      // Запрет any — использовать unknown вместо any
      // "@typescript-eslint/no-explicit-any": "error",

      // Ошибка если условие всегда true или всегда false (по данным типов)
      // "@typescript-eslint/no-unnecessary-condition": "error",

      // Ошибка если switch не покрывает все варианты union-типа
      // "@typescript-eslint/switch-exhaustiveness-check": "error",

      // Ошибка при использовании устаревшего (@deprecated) API
      // "@typescript-eslint/no-deprecated": "error",

      // Предпочитать readonly для свойств которые не меняются
      // "@typescript-eslint/prefer-readonly": "error",

      // Файл не длиннее 400 строк (не считая пустые строки и комментарии)
      // "max-lines": ["error", { max: 400, skipBlankLines: true, skipComments: true }],


      // — Для активации строгих TS-правил добавить в languageOptions: —
      // languageOptions: {
      //   parserOptions: {
      //     projectService: true,           // ESLint читает tsconfig и знает типы
      //     tsconfigRootDir: import.meta.dirname,
      //   },
      // },
    },
  },

  // scripts/ — node-скрипты сборки (icons:generate и т.п.), не браузерный код.
  {
    files: ["scripts/**/*.mjs"],
    languageOptions: {
      globals: { console: "readonly", process: "readonly" },
    },
  },

  // Граница модулей целевой архитектуры (docs: apps/web/MIGRATION.md).
  // Старые плоские папки (home/, market/, auth/ и т.п.) не попадают ни под один
  // из этих паттернов и остаются "unknown" — boundaries их не проверяет, пока
  // они не переедут в domains/platform/shared по этапам миграции.
  {
    files: ["src/**/*.{ts,tsx}"],
    plugins: { boundaries },
    settings: {
      // Резолвер алиасов (@app/@pages/@domains/@platform/@shared) из tsconfig paths —
      // без него boundaries видит только относительные импорты, а весь рефакторинг на
      // алиасах, и межслойные нарушения через @-импорты не ловились (см. MIGRATION.md).
      "import/resolver": {
        typescript: { project: "./tsconfig.json" },
      },
      "boundaries/elements": [
        { type: "app", mode: "folder", pattern: "src/app/*" },
        { type: "pages", mode: "folder", pattern: "src/pages/*" },
        { type: "domains", mode: "folder", pattern: "src/domains/*", capture: ["domain"] },
        { type: "platform", mode: "folder", pattern: "src/platform/*" },
        { type: "shared", mode: "folder", pattern: "src/shared/*" },
      ],
    },
    rules: {
      // app → pages → domains → platform → shared, домены друг друга не видят.
      "boundaries/element-types": [
        "error",
        {
          default: "disallow",
          rules: [
            { from: "app", allow: ["pages", "shared"] },
            { from: "pages", allow: ["domains", "platform", "shared"] },
            {
              from: "domains",
              allow: [["domains", { domain: "${from.domain}" }], "platform", "shared"],
            },
            // platform-подсистемы зависят друг от друга (overlay↔sound, pwa→overlay/consent/push, theme→sound).
            // Внутрислойные связи разрешены; межслойно платформа видит только shared, домены её снизу не видят.
            { from: "platform", allow: ["platform", "shared"] },
            // shared-подмодули зависят друг от друга (lib→api: activation/track/catalog из Этапа 4.1
            // используют apiFetch). Внутрислойно разрешено, самый нижний слой — наружу не видит ничего.
            { from: "shared", allow: ["shared"] },
          ],
        },
      ],
      // Импорт domains/platform/shared только через их index.ts (публичный API).
      "boundaries/entry-point": [
        "error",
        {
          default: "disallow",
          rules: [{ target: ["domains", "platform", "shared"], allow: "index.{ts,tsx}" }],
        },
      ],
    },
  },
];