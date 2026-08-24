import { defineConfig } from "vitest/config";
import ts from "typescript";

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
