import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { extractTableRefs } from "../modules/_boundaries/ownership.ts";

const SRC_DIR = path.dirname(fileURLToPath(import.meta.url)).replace(/characterization$/, "");

function productionTypeScriptFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...productionTypeScriptFiles(fullPath));
    else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) files.push(fullPath);
  }
  return files;
}

describe("user_printers write ownership during dual-runtime migration", () => {
  it("keeps non-relay writes inside the printers owner", () => {
    const foreignWriters: string[] = [];
    for (const file of productionTypeScriptFiles(SRC_DIR)) {
      const relativePath = path.relative(SRC_DIR, file);
      if (relativePath === "devices/relayInternal.ts") continue;
      for (const ref of extractTableRefs(readFileSync(file, "utf8"))) {
        if (ref.kind !== "write" || ref.table !== "user_printers") continue;
        if (relativePath.startsWith("printers/") || relativePath.startsWith("modules/printers/")) continue;
        foreignWriters.push(`${relativePath} writes user_printers owned by printers`);
      }
    }
    expect(foreignWriters).toEqual([]);
  });
});
