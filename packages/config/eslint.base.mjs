import js from "@eslint/js";
import tseslint from "typescript-eslint";

// Реэкспорт tseslint, чтобы пакеты (напр. @portal/api) могли брать пресеты (recommendedTypeChecked) и
// config()-хелпер через @portal/config, не объявляя typescript-eslint своей прямой зависимостью.
export { tseslint };

export const base = tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
    },
  },
  {
    ignores: ["dist/**", "coverage/**", ".turbo/**"],
  },
);
