import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { extractTableRefs } from "../modules/_boundaries/ownership.ts";

const SRC_DIR = path.dirname(fileURLToPath(import.meta.url)).replace(/characterization$/, "");
const PROFILE_OWNED_GOD_TABLES = new Set(["users", "user_activation"]);

function productionTypeScriptFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...productionTypeScriptFiles(fullPath));
    else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) files.push(fullPath);
  }
  return files;
}

describe("profile write ownership during dual-runtime migration", () => {
  it("keeps every users/user_activation write inside the profile owner", () => {
    const foreignWriters: string[] = [];

    for (const file of productionTypeScriptFiles(SRC_DIR)) {
      const relativePath = path.relative(SRC_DIR, file);
      const isProfileOwner = relativePath.startsWith("profile/") || relativePath.startsWith("modules/profile/");
      if (isProfileOwner) continue;

      const refs = extractTableRefs(readFileSync(file, "utf8"));
      for (const ref of refs) {
        if (ref.kind === "write" && PROFILE_OWNED_GOD_TABLES.has(ref.table)) {
          foreignWriters.push(`${relativePath} writes ${ref.table}`);
        }
      }
    }

    expect(foreignWriters).toEqual([]);
  });
});
