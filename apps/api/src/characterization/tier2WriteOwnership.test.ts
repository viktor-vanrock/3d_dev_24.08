import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { extractTableRefs } from "../modules/_boundaries/ownership.ts";

const SRC_DIR = path.dirname(fileURLToPath(import.meta.url)).replace(/characterization$/, "");

const OWNER_BY_TABLE = new Map<string, string>([
  ["votes", "community"],
  ["tags", "community"],
  ["community_members", "community"],
  ["comments", "feed"],
  ["feed_posts", "feed"],
  ["reports", "moderation"],
]);

function productionTypeScriptFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...productionTypeScriptFiles(fullPath));
    else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) files.push(fullPath);
  }
  return files;
}

describe("Tier-2 write ownership during dual-runtime migration", () => {
  it("keeps shared social-table writes inside their owners", () => {
    const foreignWriters: string[] = [];
    for (const file of productionTypeScriptFiles(SRC_DIR)) {
      const relativePath = path.relative(SRC_DIR, file);
      for (const ref of extractTableRefs(readFileSync(file, "utf8"))) {
        if (ref.kind !== "write") continue;
        const owner = OWNER_BY_TABLE.get(ref.table);
        if (owner === undefined) continue;
        if (relativePath.startsWith(`${owner}/`) || relativePath.startsWith(`modules/${owner}/`)) continue;
        foreignWriters.push(`${relativePath} writes ${ref.table} owned by ${owner}`);
      }
    }
    expect(foreignWriters).toEqual([]);
  });
});
