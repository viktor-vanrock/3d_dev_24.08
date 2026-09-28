/* global process, console */
import pg from "pg";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const directory = path.dirname(fileURLToPath(import.meta.url));
for (const line of fs.readFileSync(path.join(directory, "..", ".env"), "utf8").split("\n")) {
  const match = line.match(/^([^#=]+)=(.*)$/);
  if (match) process.env[match[1].trim()] ??= match[2].trim();
}
const migrations = ["20260928000000_expand_reports_to_moderation_flags.sql", "20260928000001_create_flag_evidence.sql", "20260928000002_create_flag_claims.sql", "20260928000003_create_moderation_decisions.sql", "20260928000004_create_content_restrictions.sql", "20260928000005_add_moderation_audit_actions.sql"];
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const client = await pool.connect();
try {
  await client.query("create table if not exists schema_migrations (filename text primary key)");
  for (const filename of migrations) {
    if ((await client.query("select 1 from schema_migrations where filename = $1", [filename])).rowCount) { console.log(`SKIP: ${filename}`); continue; }
    let sql = fs.readFileSync(path.join(directory, "..", "db", "migrations", filename), "utf8");
    sql = sql.slice(0, sql.indexOf("-- migrate:down") === -1 ? undefined : sql.indexOf("-- migrate:down")).replace(/^-- migrate:up\s*/m, "");
    console.log(`APPLYING: ${filename}`);
    await client.query("begin");
    try { await client.query(sql); await client.query("insert into schema_migrations values ($1)", [filename]); await client.query("commit"); console.log(`OK: ${filename}`); }
    catch (error) { await client.query("rollback"); throw error; }
  }
} finally { client.release(); await pool.end(); }
