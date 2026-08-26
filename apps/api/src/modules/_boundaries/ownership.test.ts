import { describe, expect, it } from "vitest";
import { extractTableRefs, ownedTables, ownerOf, ownership, KNOWN_TABLES } from "./ownership.ts";

// Unit tests for the layer-2 machinery. These prove the SQL extractor catches the real violation
// classes (foreign JOIN, cross-domain write) and does NOT false-positive on CTEs/aliases — before the
// sqlOwnership manifest test relies on it against migrated domains.

describe("ownership map", () => {
  it("loads the authoritative map (128 tables, 30 domains)", () => {
    expect(Object.keys(ownership.tables).length).toBe(128);
    expect(Object.keys(ownership.domains).length).toBe(30);
  });

  it("every owned table resolves back to its domain", () => {
    for (const [domain, tables] of Object.entries(ownership.domains)) {
      for (const t of tables) {
        expect(ownerOf(t)).toBe(domain);
      }
    }
  });

  it("god-tables carry the expected owners", () => {
    expect(ownerOf("users")).toBe("profile");
    expect(ownerOf("models")).toBe("projects");
    expect(ownedTables("projects")).toContain("model_revision_files");
  });

  it("KNOWN_TABLES covers the physical schema (148) and every owned table", () => {
    expect(KNOWN_TABLES.size).toBe(148);
    for (const t of Object.keys(ownership.tables)) {
      expect(KNOWN_TABLES.has(t)).toBe(true);
    }
  });
});

describe("extractTableRefs", () => {
  it("detects a foreign read via multi-line JOIN (the seo→models god-table case)", () => {
    // Verbatim shape from src/seo/ogimage.ts — the exact violation layer 2 must catch once seo migrates.
    const sql = `
      select m.id, f.key
      from models m
      join model_revision_files f on f.model_revision_id = m.latest_revision_id and f.role = 'thumbnail'
      where m.status = 'ready'`;
    const refs = extractTableRefs(sql);
    const reads = refs
      .filter((r) => r.kind === "read")
      .map((r) => r.table)
      .sort();
    expect(reads).toEqual(["model_revision_files", "models"]);
  });

  it("classifies INSERT/UPDATE/DELETE of KNOWN tables as writes", () => {
    expect(extractTableRefs("insert into agents (id) values ($1)")).toEqual([{ table: "agents", kind: "write" }]);
    expect(extractTableRefs("update users set status = 'banned' where id = $1")).toEqual([{ table: "users", kind: "write" }]);
    expect(extractTableRefs("delete from votes where id = $1")).toEqual([{ table: "votes", kind: "write" }]);
  });

  it("ignores CTE names, aliases, and unknown identifiers", () => {
    const sql = `
      with recent as (
        select id from models where created_at > now() - interval '1 day'
      )
      select r.id from recent r join not_a_real_table x on x.id = r.id`;
    const tables = extractTableRefs(sql)
      .map((r) => r.table)
      .sort();
    // `recent` is a CTE (excluded), `not_a_real_table` is unknown (excluded), only physical `models` remains.
    expect(tables).toEqual(["models"]);
  });

  it("does not match a table name that appears only inside a string literal or comment", () => {
    const sql = `
      select id from agents  -- join models here would be a violation
      where label = 'select from users'`;
    const tables = extractTableRefs(sql)
      .map((r) => r.table)
      .sort();
    // `models` (in a comment) and `users` (in a string) must be stripped; only the real FROM target remains.
    expect(tables).toEqual(["agents"]);
  });

  it("handles schema-qualified and quoted table names", () => {
    expect(extractTableRefs('select * from public."models"').map((r) => r.table)).toEqual(["models"]);
  });
});
