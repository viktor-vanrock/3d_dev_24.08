// Layer 2 core (design.md §7.2, spec domain-boundaries → «Единственный владелец записи таблицы» +
// «Чтение чужих данных только через публичный контракт»). Typed access to the authoritative
// table→owner map and the physical-table universe, plus a SQL table-reference extractor used by the
// boundary test. Pure, no framework, no DB.

import ownershipData from "./table-ownership.json" with { type: "json" };
import schemaTables from "./schema-tables.json" with { type: "json" };

export interface TableOwnership {
  owner: string;
  writers: string[];
  crossDomain: boolean;
}

export interface OwnershipMap {
  tables: Record<string, TableOwnership>;
  domains: Record<string, string[]>;
}

// Per-domain ownership manifest shape (declared by each domain's infrastructure/<domain>.tables.ts).
// Canonical home is here in _boundaries so both the boundary test and the domains reference one type.
export type DomainTableManifest = {
  readonly owns: readonly string[];
  readonly readsForeignViews: readonly string[];
};

export const ownership = ownershipData as OwnershipMap;

/** Every physical table name known to db/schema.sql (140). Used to tell a real table from a CTE/alias/keyword. */
export const KNOWN_TABLES: ReadonlySet<string> = new Set(schemaTables);

/** Tables a given domain is the sole write-owner of (seed for its infrastructure/<domain>.tables.ts). */
export function ownedTables(domain: string): string[] {
  return ownership.domains[domain] ?? [];
}

/** Owner domain of a physical table, or undefined if the table is read-only / unknown. */
export function ownerOf(table: string): string | undefined {
  return ownership.tables[table]?.owner;
}

// Published, versioned read-views that isolate readers from a god-table's physical schema
// (design.md §7.1). Reading one of these from a foreign domain is ALLOWED; reading the physical
// god-table is not. Populated as owners publish views in phase 6 (task 6.0). The suffix `_v#` marks
// the contract version.
export const PUBLISHED_READ_VIEWS: ReadonlySet<string> = new Set<string>([
  "identity_read_v1", // users god-table (R:16) — published by profile (task 6.0)
]);

// ── SQL table-reference extraction ───────────────────────────────────────────────────────────────
// Deliberately conservative: we want to catch a foreign PHYSICAL table appearing after FROM/JOIN/INTO/
// UPDATE/DELETE FROM, while not false-positiving on CTE names, aliases, or subqueries. We resolve each
// candidate against KNOWN_TABLES, and drop names bound by a `with <name> as (` CTE in the same string.

const TABLE_REF_RE = /\b(?:from|join|into|update|delete\s+from)\s+(?:only\s+)?(?:public\.)?"?([a-z_][a-z0-9_]*)"?/gi;
const CTE_RE = /\bwith\s+(?:recursive\s+)?([\s\S]*?)\bas\s*\(/gi;
const CTE_NAME_RE = /\b([a-z_][a-z0-9_]*)\s+as\s*\(/gi;

export interface TableRef {
  table: string;
  kind: "read" | "write"; // write = INTO/UPDATE/DELETE FROM; read = FROM/JOIN
}

/**
 * Extract references to KNOWN physical tables from a SQL string. CTE names declared in the same
 * statement are excluded. Unknown identifiers (aliases, CTEs, functions) are ignored — the goal is to
 * flag *foreign physical tables*, and every physical table is in KNOWN_TABLES.
 */
export function extractTableRefs(rawSql: string): TableRef[] {
  const sql = stripLiteralsAndComments(rawSql);
  const cteNames = collectCteNames(sql);
  const refs: TableRef[] = [];
  const seen = new Set<string>();

  for (const m of sql.matchAll(TABLE_REF_RE)) {
    const table = m[1]?.toLowerCase();
    // Recognize physical tables AND published read-views: a domain reading `project_read_v1` must be
    // SEEN so the ownership test can allow it (any domain), while reading the physical god-table stays
    // a violation. Views are read-only, so a view ref is always classified read below.
    if (!table || cteNames.has(table) || !(KNOWN_TABLES.has(table) || PUBLISHED_READ_VIEWS.has(table))) continue;
    const lead = m[0].toLowerCase();
    const kind: TableRef["kind"] = /into|update|delete/.test(lead) ? "write" : "read";
    const key = `${kind}:${table}`;
    if (seen.has(key)) continue;
    seen.add(key);
    refs.push({ table, kind });
  }
  return refs;
}

// Replace SQL string literals ('...') and comments (-- line, /* block */) with spaces so a table name
// mentioned inside a literal/comment can't be mistaken for a real FROM/JOIN target. Length is preserved
// loosely; only identifier boundaries matter downstream.
function stripLiteralsAndComments(sql: string): string {
  return sql
    .replace(/--[^\n]*/g, " ") // line comments
    .replace(/\/\*[\s\S]*?\*\//g, " ") // block comments
    .replace(/'(?:''|[^'])*'/g, "''"); // single-quoted string literals (SQL escapes '' inside)
}

function collectCteNames(sql: string): Set<string> {
  const names = new Set<string>();
  for (const block of sql.matchAll(CTE_RE)) {
    const head = block[1] ?? "";
    for (const n of head.matchAll(CTE_NAME_RE)) {
      if (n[1]) names.add(n[1].toLowerCase());
    }
  }
  // Also the simple leading `with x as (` that CTE_RE's lazy body may skip.
  for (const n of sql.matchAll(/\bwith\s+(?:recursive\s+)?"?([a-z_][a-z0-9_]*)"?\s+as\s*\(/gi)) {
    if (n[1]) names.add(n[1].toLowerCase());
  }
  return names;
}
