import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { extractTableRefs } from "./ownership.ts";

const MODULES_DIR = path.dirname(fileURLToPath(import.meta.url)).replace(/_boundaries$/, "");
const ALLOWED_PATHS = new Set([
  "models/infrastructure/repo-backfill.ts",
  "profile/infrastructure/profile.repository.ts", // view owner; audit read surface is declared here.
]);

function productionTsFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return productionTsFiles(full);
    return entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts") ? [full] : [];
  });
}

function readsIdentityAll(file: string): boolean {
  return extractTableRefs(readFileSync(file, "utf8")).some((reference) => reference.kind === "read" && reference.table === "identity_read_all_v1");
}

describe("identity_read_all_v1 use boundary", () => {
  it("allows the staff/audit view only in the minimal reviewed allowlist", () => {
    const readers = productionTsFiles(MODULES_DIR)
      .filter(readsIdentityAll)
      .map((file) => path.relative(MODULES_DIR, file));
    expect(readers.filter((file) => !ALLOWED_PATHS.has(file))).toEqual([]);
  });

  it("recognises a forbidden public-path use", () => {
    const forbiddenPath = "projects/infrastructure/postgres-project.repository.ts";
    const refs = extractTableRefs("select user_id from identity_read_all_v1 where user_id = $1");
    expect(refs).toEqual([{ table: "identity_read_all_v1", kind: "read" }]);
    expect(ALLOWED_PATHS.has(forbiddenPath)).toBe(false);
  });
});
