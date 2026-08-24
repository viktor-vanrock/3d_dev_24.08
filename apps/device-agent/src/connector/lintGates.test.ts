import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

const eslint = new ESLint({ cwd: new URL("../..", import.meta.url).pathname });

async function ruleIds(source: string, fileName: string): Promise<Array<string | null>> {
  const [result] = await eslint.lintText(source, {
    filePath: new URL(fileName, import.meta.url).pathname,
    warnIgnored: false,
  });
  return result?.messages.map(({ ruleId }) => ruleId) ?? [];
}

describe("connector type-aware lint gates", () => {
  it("rejects explicit any", async () => {
    await expect(ruleIds("export const value: any = 1;", "composition.ts")).resolves.toContain(
      "@typescript-eslint/no-explicit-any",
    );
  });

  it("rejects unchecked double casts", async () => {
    await expect(ruleIds("export const value = 1 as unknown as string;", "composition.ts")).resolves.toContain(
      "no-restricted-syntax",
    );
  });

  it("rejects blanket disables", async () => {
    await expect(ruleIds("/* eslint-disable */\nexport const value = 1;", "composition.ts")).resolves.toContain(
      "no-warning-comments",
    );
  });

  it("rejects JSON.parse outside the validated config boundary", async () => {
    await expect(ruleIds("export const value: unknown = JSON.parse('{}');", "composition.ts")).resolves.toContain(
      "no-restricted-syntax",
    );
  });
});
