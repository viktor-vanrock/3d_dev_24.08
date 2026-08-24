import { pathToFileURL } from "node:url";

import { pool } from "../src/db/client.ts";
import { inspectRepoBackfillCompletion, reconcileDescriptionCache, runRepoBackfill, verifyRepoBackfill } from "../src/modules/models/public/operations.ts";

type Mode = "completion" | "migrate" | "verify" | "reconcile";

export function parseArguments(args: readonly string[]): { mode: Mode; limit?: number } {
  const modes = [args.includes("--completion-check"), args.includes("--migrate"), args.includes("--verify-only"), args.includes("--reconcile-descriptions")];
  if (modes.filter(Boolean).length !== 1) throw new Error("choose exactly one mode: --completion-check, --migrate, --verify-only, or --reconcile-descriptions");
  const limitIndex = args.indexOf("--limit");
  const rawLimit = limitIndex === -1 ? undefined : args[limitIndex + 1];
  if (limitIndex !== -1 && (!rawLimit || !/^\d+$/.test(rawLimit) || Number(rawLimit) < 1)) throw new Error("--limit must be a positive integer");
  const mode = modes[0] ? "completion" : modes[1] ? "migrate" : modes[2] ? "verify" : "reconcile";
  if (mode === "completion" && rawLimit !== undefined) throw new Error("--completion-check must be exhaustive and cannot be combined with --limit");
  return {
    mode,
    ...(rawLimit === undefined ? {} : { limit: Number(rawLimit) }),
  };
}

async function main(): Promise<void> {
  const { mode, limit } = parseArguments(process.argv.slice(2));
  try {
    if (mode === "completion") {
      const report = await inspectRepoBackfillCompletion();
      console.log(
        `complete=${report.complete} pending_projects=${report.pendingProjects} files_missing_in_git=${report.verification.filesMissingInGit.length} ` +
          `files_missing_in_s3=${report.verification.filesMissingInS3.length} git_hash_mismatches=${report.verification.gitHashMismatches.length} ` +
          `s3_hash_mismatches=${report.verification.s3HashMismatches.length} description_cache_mismatches=${report.descriptionCacheMismatches.length}`,
      );
      if (!report.complete) process.exitCode = 1;
      return;
    }
    if (mode === "reconcile") {
      const report = await reconcileDescriptionCache({ limit });
      console.log(`projects_checked=${report.projectsChecked} reconciled=${report.reconciled.length} errors=${report.errors.length}`);
      if (report.reconciled.length > 0) console.log(`reconciled project ids: ${report.reconciled.join(", ")}`);
      if (report.errors.length > 0) console.log(`errors: ${JSON.stringify(report.errors)}`);
      if (report.errors.length > 0) process.exitCode = 1;
      return;
    }

    if (mode === "verify") {
      const report = await verifyRepoBackfill({ limit });
      console.log(
        `projects_checked=${report.projectsChecked} files_checked=${report.filesChecked} missing_in_git=${report.filesMissingInGit.length} ` +
          `missing_in_s3=${report.filesMissingInS3.length} git_hash_mismatches=${report.gitHashMismatches.length} ` +
          `s3_hash_mismatches=${report.s3HashMismatches.length} errors=${report.errors.length}`,
      );
      if (report.filesMissingInGit.length > 0) console.log(`missing_in_git file ids: ${report.filesMissingInGit.join(", ")}`);
      if (report.filesMissingInS3.length > 0) console.log(`missing_in_s3 file ids: ${report.filesMissingInS3.join(", ")}`);
      if (report.gitHashMismatches.length > 0) console.log(`git_hash_mismatches file ids: ${report.gitHashMismatches.join(", ")}`);
      if (report.s3HashMismatches.length > 0) console.log(`s3_hash_mismatches file ids: ${report.s3HashMismatches.join(", ")}`);
      if (report.errors.length > 0) console.log(`errors: ${JSON.stringify(report.errors)}`);
      if (
        report.filesMissingInGit.length > 0 ||
        report.filesMissingInS3.length > 0 ||
        report.gitHashMismatches.length > 0 ||
        report.s3HashMismatches.length > 0 ||
        report.errors.length > 0
      ) {
        process.exitCode = 1;
      }
      return;
    }

    const report = await runRepoBackfill({ limit });
    console.log(
      `candidates=${report.candidates} migrated=${report.migrated} files_committed=${report.filesCommitted} ` +
        `files_already_present=${report.filesAlreadyPresent} files_missing_in_s3=${report.filesMissingInS3.length} ` +
        `hash_mismatches=${report.hashMismatches.length} errors=${report.errors.length}`,
    );
    if (report.filesMissingInS3.length > 0) console.log(`files_missing_in_s3 file ids: ${report.filesMissingInS3.join(", ")}`);
    if (report.hashMismatches.length > 0) console.log(`hash_mismatches file ids: ${report.hashMismatches.join(", ")}`);
    if (report.errors.length > 0) console.log(`errors: ${JSON.stringify(report.errors)}`);
    if (report.filesMissingInS3.length > 0 || report.hashMismatches.length > 0 || report.errors.length > 0) process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
