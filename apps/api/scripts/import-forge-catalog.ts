import { resolve } from "node:path";
import type { PoolClient } from "pg";

import { pool } from "../src/db/client.ts";
import { assertExplicitOperationalTarget } from "./dev-seed-guard.ts";
import { importMachines } from "./forge-catalog/machines.ts";
import { importMaterials } from "./forge-catalog/materials.ts";
import { importNews } from "./forge-catalog/news.ts";
import { importOfdMaterials } from "./forge-catalog/ofd-materials.ts";
import { importHistory } from "./forge-catalog/history.ts";
import { importEnrichment } from "./forge-catalog/enrichment.ts";
import type { ForgeCatalogReport, SectionReport } from "./forge-catalog/types.ts";

interface Options {
  readonly sourceDirectory: string;
  readonly apply: boolean;
  readonly sections: ReadonlySet<string>;
  readonly authorId: string | null;
  readonly communityId: string | null;
  readonly newsStatus: "draft" | "visible";
}

function optionValue(args: readonly string[], name: string): string | null {
  const index = args.indexOf(name);
  if (index < 0) return null;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} requires a value`);
  return value;
}

export function parseOptions(args: readonly string[]): Options {
  const source = optionValue(args, "--source-dir");
  if (!source) throw new Error("usage: import-forge-catalog --source-dir DIR [--sections machines,materials,ofd,history,enrichment,news] [--apply --author-id UUID] [--community-id UUID]");
  const sections = new Set((optionValue(args, "--sections") ?? "machines,materials,news").split(",").filter(Boolean));
  for (const section of sections) if (!new Set(["machines", "materials", "ofd", "history", "enrichment", "news"]).has(section)) throw new Error(`unknown section: ${section}`);
  const newsStatus = optionValue(args, "--news-status") ?? "draft";
  if (!(newsStatus === "draft" || newsStatus === "visible")) throw new Error("--news-status must be draft or visible");
  return { sourceDirectory: resolve(source), apply: args.includes("--apply"), sections, authorId: optionValue(args, "--author-id"), communityId: optionValue(args, "--community-id"), newsStatus };
}

async function runSection(name: string, action: (client: PoolClient | null) => Promise<SectionReport>, apply: boolean): Promise<SectionReport> {
  if (!apply) return action(null);
  const client = await pool.connect();
  try {
    await client.query("begin");
    const report = await action(client);
    await client.query("commit");
    return report;
  } catch (error) {
    await client.query("rollback");
    const message = error instanceof Error ? error.message : "unknown error";
    throw new Error(`${name} import failed: ${message}`);
  } finally {
    client.release();
  }
}

export async function run(options: Options): Promise<ForgeCatalogReport> {
  if (options.apply) await assertExplicitOperationalTarget(pool, "forge catalog import", "FORGE_IMPORT_DB_NAME");
  const sections: Record<string, SectionReport> = {};
  if (options.sections.has("machines")) sections.machines = await runSection("machines", (client) => importMachines(client, options.sourceDirectory), options.apply);
  if (options.sections.has("materials")) sections.materials = await runSection("materials", (client) => importMaterials(client, options.sourceDirectory), options.apply);
  if (options.sections.has("ofd")) sections.ofd = await runSection("ofd", (client) => importOfdMaterials(client, options.sourceDirectory), options.apply);
  if (options.sections.has("history")) sections.history = await runSection("history", (client) => importHistory(client, options.sourceDirectory), options.apply);
  if (options.sections.has("enrichment")) sections.enrichment = await runSection("enrichment", (client) => importEnrichment(client, options.sourceDirectory), options.apply);
  if (options.sections.has("news")) sections.news = await runSection("news", (client) => importNews(client, options.sourceDirectory, options.authorId, options.communityId, options.newsStatus), options.apply);
  return { schemaVersion: "forge-catalog-import-report.v1", sourceDirectory: options.sourceDirectory, mode: options.apply ? "apply" : "dry-run", generatedAt: new Date().toISOString(), sections };
}

if (process.argv[1]?.endsWith("import-forge-catalog.ts")) {
  run(parseOptions(process.argv.slice(2))).then((report) => { process.stdout.write(`${JSON.stringify(report, null, 2)}\n`); }).catch((error: unknown) => { process.stderr.write(`${error instanceof Error ? error.message : "unknown error"}\n`); process.exitCode = 1; }).finally(() => pool.end());
}
