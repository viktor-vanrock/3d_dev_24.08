import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import ownership from "../../_boundaries/table-ownership.json" with { type: "json" };
import { GENERATIONS_OWNED_TABLES } from "./generations.tables.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
describe("generations ownership boundary", () => {
  it("matches the authoritative three-table ownership manifest", () => {
    const tables = ownership.tables as Record<string, { readonly owner: string }>;
    expect([...GENERATIONS_OWNED_TABLES].sort()).toEqual(
      Object.keys(tables)
        .filter((table) => tables[table]?.owner === "generations")
        .sort(),
    );
  });
  it("contains no direct SQL writes to models or model_files", async () => {
    const source = await readFile(join(root, "infrastructure/generations.repository.ts"), "utf8");
    expect(source).not.toMatch(/(?:insert\s+into|update|delete\s+from)\s+(?:models|model_files)\b/i);
  });
});
