import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import ts from "typescript";

// Keep test credentials separate from the development database.
// Explicit environment variables take precedence over .env.test.
const testEnvFile = fileURLToPath(new URL("./.env.test", import.meta.url));
if (existsSync(testEnvFile)) loadEnvFile(testEnvFile);

export default defineConfig({
  plugins: [
    {
      name: "api-decorator-metadata",
      enforce: "pre",
      transform(source, id) {
        const filename = id.split("?", 1)[0]!;
        if (!filename.endsWith(".ts") || filename.includes("/node_modules/")) return null;
        const result = ts.transpileModule(source, {
          fileName: filename,
          compilerOptions: {
            target: ts.ScriptTarget.ES2022,
            module: ts.ModuleKind.ESNext,
            moduleResolution: ts.ModuleResolutionKind.Bundler,
            experimentalDecorators: true,
            emitDecoratorMetadata: true,
            sourceMap: true,
            inlineSources: true,
          },
        });
        return {
          code: result.outputText,
          map: result.sourceMapText === undefined ? null : JSON.parse(result.sourceMapText),
        };
      },
    },
  ],
  test: {
    globalSetup: ["./src/test/dbSafetyGuard.ts"],
  },
});
