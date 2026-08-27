import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { extractTableRefs } from "../../_boundaries/ownership.ts";
import { sanctionsTables } from "./sanctions.tables.ts";

describe("sanctions module boundary", () => {
  it("declares only its owned physical tables", () => {
    expect(sanctionsTables.owns).toEqual(["sanctions", "sanction_appeals"]);
  });

  it("does not leak the repository through the public barrel", () => {
    const source = readFileSync(fileURLToPath(new URL("../public/index.ts", import.meta.url)), "utf8");
    expect(source).not.toMatch(/repository|infrastructure/i);
  });

  it("detector recognises a forbidden foreign users-table read", () => {
    const refs = extractTableRefs("select id from users where id = $1");
    expect(refs).toEqual([{ table: "users", kind: "read" }]);
    expect(sanctionsTables.owns).not.toContain("users");
    expect(sanctionsTables.readsForeignViews).not.toContain("users");
  });
});
