// Прогон адаптеров-источников каталога станков (MF-406, декомпозиция MF-648) — обёртка над
// runIngest (src/modules/catalog/infrastructure/ingest/run.ts): fetch адаптера → идемпотентный upsert
// machine_candidates → аудит-лог ingest_runs. Repository systemd-шаблоны расписания:
// deploy/portal.catalog-ingest.service и deploy/portal.catalog-ingest.timer.
//
// Запуск:
//   pnpm --filter @portal/api run ingest:run                                   — все адаптеры
//   pnpm --filter @portal/api run ingest:run -- --adapter sovol3d-store
//   pnpm --filter @portal/api run ingest:run -- --adapter cura-definitions --limit 50
// env: DATABASE_URL (обяз.).

import { pathToFileURL } from "node:url";
import { pool } from "../src/db/client.ts";
import { CuraDefinitionsAdapter, runIngest, Sovol3dStoreAdapter, type SourceAdapter } from "../src/modules/catalog/public/operations.ts";

interface IngestRunnerDependencies {
  adapters: SourceAdapter[];
  run: typeof runIngest;
  close: () => Promise<void>;
  log: (message: string) => void;
  error: (message: string, error: unknown) => void;
}

export interface IngestSourceReport {
  source: string;
  status: "ok" | "failed";
  found: number;
  changed: number;
  rejected: number;
  error?: string;
}

function flagValue(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

export function selectAdapters(args: string[], all: SourceAdapter[]): SourceAdapter[] {
  const adapterArg = flagValue(args, "--adapter");
  if (!adapterArg || adapterArg === "all") return all;
  const chosen = all.find((adapter) => adapter.id === adapterArg);
  if (!chosen) {
    throw new Error(`Неизвестный адаптер: ${adapterArg} (доступны: all, ${all.map((adapter) => adapter.id).join(", ")})`);
  }
  return [chosen];
}

export async function runSelectedAdapters(
  adapters: SourceAdapter[],
  run: typeof runIngest,
  log: (message: string) => void,
  error: (message: string, error: unknown) => void,
): Promise<IngestSourceReport[]> {
  const reports: IngestSourceReport[] = [];
  for (const adapter of adapters) {
    log(`→ ${adapter.id}`);
    try {
      const result = await run(adapter);
      reports.push({ source: adapter.id, status: "ok", ...result });
      log(`  found=${result.found} changed=${result.changed} rejected=${result.rejected}`);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      reports.push({ source: adapter.id, status: "failed", found: 0, changed: 0, rejected: 0, error: message });
      error(`  failed: ${adapter.id}`, caught);
    }
  }
  return reports;
}

export async function runIngestCli(args: string[], dependencies: IngestRunnerDependencies): Promise<number> {
  try {
    const selected = selectAdapters(args, dependencies.adapters);
    const reports = await runSelectedAdapters(selected, dependencies.run, dependencies.log, dependencies.error);
    const succeeded = reports.filter((report) => report.status === "ok");
    const failed = reports.length - succeeded.length;
    const totals = succeeded.reduce((sum, report) => ({ found: sum.found + report.found, changed: sum.changed + report.changed, rejected: sum.rejected + report.rejected }), {
      found: 0,
      changed: 0,
      rejected: 0,
    });
    dependencies.log(
      `summary sources=${reports.length} succeeded=${succeeded.length} failed=${failed} found=${totals.found} changed=${totals.changed} rejected=${totals.rejected}`,
    );
    return failed === 0 ? 0 : 1;
  } finally {
    await dependencies.close();
  }
}

function parseLimit(args: string[]): number | undefined {
  const value = flagValue(args, "--limit");
  if (value === undefined) return undefined;
  const limit = Number(value);
  if (!Number.isInteger(limit) || limit < 0) throw new Error(`Некорректный --limit: ${value}`);
  return limit;
}

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  const adapters: SourceAdapter[] = [new CuraDefinitionsAdapter({ limit: parseLimit(args) }), new Sovol3dStoreAdapter()];
  return runIngestCli(args, {
    adapters,
    run: runIngest,
    close: () => pool.end(),
    log: (message) => console.log(message),
    error: (message, caught) => console.error(message, caught),
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
    .then((exitCode) => {
      process.exitCode = exitCode;
    })
    .catch((err: unknown) => {
      console.error(err);
      process.exitCode = 1;
    });
}
