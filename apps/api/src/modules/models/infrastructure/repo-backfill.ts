import { createHash } from "node:crypto";
import type { QueryResultRow } from "pg";
import { pool } from "../../../db/client.ts";
import { absoluteRepoPath, GIT_BACKED_ROLES, gitAuthorForUser, repoDirNameForModel, repoFilePath, type RepoFileRole } from "../../../git/paths.ts";
import { commitFile, commitReadme, initBareRepo, readFileContent, readTree, type CommitAuthor } from "../../../git/repo.ts";
import { getModelObjectStream, isModelsStorageConfigured } from "../../../storage/s3.ts";

interface DatabaseTarget {
  query<Row extends QueryResultRow>(text: string, values?: unknown[]): Promise<{ rows: Row[] }>;
}

export interface RepoBackfillDependencies {
  database: DatabaseTarget;
  storageConfigured: () => boolean;
  getObjectStream: typeof getModelObjectStream;
  initBareRepo: typeof initBareRepo;
  readTree: typeof readTree;
  readFileContent: typeof readFileContent;
  commitFile: typeof commitFile;
  commitReadme: typeof commitReadme;
  env: NodeJS.ProcessEnv;
}

const defaultDependencies: RepoBackfillDependencies = {
  database: pool,
  storageConfigured: isModelsStorageConfigured,
  getObjectStream: getModelObjectStream,
  initBareRepo,
  readTree,
  readFileContent,
  commitFile,
  commitReadme,
  env: process.env,
};

interface PendingProjectRow {
  id: string;
  description: string | null;
  owner_id: string;
  owner_username: string;
}

interface GitBackedFileRow {
  id: string;
  role: RepoFileRole;
  s3_key: string | null;
  original_filename: string | null;
  checksum: Buffer;
  craft: string;
}

interface MigratedProjectRow {
  id: string;
  repo_path: string;
  description: string | null;
}

export interface ProjectBackfillResult {
  projectId: string;
  migrated: boolean;
  filesCommitted: number;
  filesAlreadyPresent: number;
  filesMissingInS3: string[];
  hashMismatches: string[];
  readmeCommitted: boolean;
}

export interface BackfillReport {
  candidates: number;
  migrated: number;
  filesCommitted: number;
  filesAlreadyPresent: number;
  filesMissingInS3: string[];
  hashMismatches: string[];
  errors: { projectId: string; error: string }[];
}

export interface VerificationReport {
  projectsChecked: number;
  filesChecked: number;
  filesMissingInGit: string[];
  filesMissingInS3: string[];
  gitHashMismatches: string[];
  s3HashMismatches: string[];
  errors: { projectId: string; error: string }[];
}

export interface DescriptionCacheReport {
  projectsChecked: number;
  reconciled: string[];
  errors: { projectId: string; error: string }[];
}

export interface RepoBackfillCompletionReport {
  pendingProjects: number;
  verification: VerificationReport;
  descriptionCacheMismatches: string[];
  descriptionCacheErrors: { projectId: string; error: string }[];
  complete: boolean;
}

export const REPO_BACKFILL_COMPLETION_QUERIES = {
  pendingRepositoryMigration: `select count(*)::text as count from projects where repo_path is null and deleted_at is null`,
  migratedProjects: `select id, repo_path, description from projects where repo_path is not null and deleted_at is null order by created_at limit $1`,
} as const;

function extFromS3Key(key: string | null): string {
  if (key === null) return "bin";
  const lastDot = key.lastIndexOf(".");
  return lastDot === -1 ? "bin" : key.slice(lastDot + 1);
}

function filenameForFile(file: GitBackedFileRow): string {
  return file.original_filename ?? `${file.role}.${extFromS3Key(file.s3_key)}`;
}

async function streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream as AsyncIterable<Buffer | Uint8Array | string>) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks);
}

export async function assertRepoBackfillMutationTarget(dependencies: RepoBackfillDependencies = defaultDependencies): Promise<void> {
  if (!dependencies.env.DATABASE_URL) throw new Error("repo backfill: DATABASE_URL is required for mutating modes");
  const expected = dependencies.env.BACKFILL_REPOS_DB_NAME?.trim();
  if (!expected) throw new Error("repo backfill: BACKFILL_REPOS_DB_NAME must explicitly name the target database for mutating modes");
  const result = await dependencies.database.query<{ db: string }>("select current_database() as db");
  const actual = result.rows[0]?.db;
  if (!actual) throw new Error("repo backfill: current_database() returned no database name");
  if (actual !== expected) throw new Error(`repo backfill: connected database '${actual}' does not match BACKFILL_REPOS_DB_NAME='${expected}'`);
}

async function fetchPendingProjects(limit: number, dependencies: RepoBackfillDependencies): Promise<PendingProjectRow[]> {
  const result = await dependencies.database.query<PendingProjectRow>(
    `select p.id, p.description, p.owner_id, u.username as owner_username
       from projects p
       join identity_read_v1 u on u.user_id = p.owner_id
      where p.repo_path is null and p.deleted_at is null
      order by p.created_at
      limit $1`,
    [limit],
  );
  return result.rows;
}

async function fetchGitBackedFiles(projectId: string, dependencies: RepoBackfillDependencies): Promise<GitBackedFileRow[]> {
  const result = await dependencies.database.query<GitBackedFileRow>(
    `select f.id, f.role, b.s3_key, f.original_filename, f.checksum, r.craft
       from models m
       join model_revisions r on r.id = m.latest_revision_id and r.model_id = m.id
       join model_revision_files f on f.model_revision_id = r.id and f.role = any($2::text[])
       left join storage_blobs b on b.id = f.blob_id and b.state = 'ready'
      where m.project_id = $1 and m.deleted_at is null
      order by m.position, f.created_at, f.id`,
    [projectId, GIT_BACKED_ROLES],
  );
  return result.rows;
}

async function fetchMigratedProjects(limit: number, dependencies: RepoBackfillDependencies): Promise<MigratedProjectRow[]> {
  return (await dependencies.database.query<MigratedProjectRow>(REPO_BACKFILL_COMPLETION_QUERIES.migratedProjects, [limit])).rows;
}

async function migrateOneProject(project: PendingProjectRow, dependencies: RepoBackfillDependencies): Promise<ProjectBackfillResult> {
  const repoDirName = repoDirNameForModel(project.id);
  const repoPath = absoluteRepoPath(repoDirName);
  const author: CommitAuthor = gitAuthorForUser({ id: project.owner_id, username: project.owner_username });
  await dependencies.initBareRepo(repoPath);

  const files = await fetchGitBackedFiles(project.id, dependencies);
  const existingTree = await dependencies.readTree(repoPath);
  const existingPaths = new Set(existingTree.map((entry) => entry.path));
  const plannedPaths = new Set<string>();
  const result: ProjectBackfillResult = {
    projectId: project.id,
    migrated: false,
    filesCommitted: 0,
    filesAlreadyPresent: 0,
    filesMissingInS3: [],
    hashMismatches: [],
    readmeCommitted: false,
  };

  for (const file of files) {
    const filePath = repoFilePath(file.role, file.craft, filenameForFile(file));
    if (plannedPaths.has(filePath)) throw new Error(`multiple current model files resolve to '${filePath}'`);
    plannedPaths.add(filePath);

    let gitAlreadyMatches = false;
    if (existingPaths.has(filePath)) {
      const existingContent = await dependencies.readFileContent(repoPath, filePath);
      if (existingContent && createHash("sha256").update(existingContent).digest().equals(file.checksum)) {
        gitAlreadyMatches = true;
      }
    }

    if (file.s3_key === null) {
      result.filesMissingInS3.push(file.id);
      continue;
    }
    const stream = await dependencies.getObjectStream(file.s3_key);
    if (!stream) {
      result.filesMissingInS3.push(file.id);
      continue;
    }
    const content = await streamToBuffer(stream.body);
    if (!createHash("sha256").update(content).digest().equals(file.checksum)) {
      result.hashMismatches.push(file.id);
      continue;
    }
    if (gitAlreadyMatches) {
      result.filesAlreadyPresent += 1;
      continue;
    }
    await dependencies.commitFile(repoPath, { filePath, content, message: `feat: backfill import ${filePath}`, author });
    result.filesCommitted += 1;
  }

  if (project.description) {
    const currentReadme = await dependencies.readFileContent(repoPath, "README.md");
    if (!currentReadme || currentReadme.toString("utf8") !== project.description) {
      await dependencies.commitReadme(repoPath, project.description, author);
      result.readmeCommitted = true;
    }
  }

  if (result.filesMissingInS3.length === 0 && result.hashMismatches.length === 0) {
    await dependencies.database.query(`update projects set repo_path = $2 where id = $1 and repo_path is null`, [project.id, repoDirName]);
    result.migrated = true;
  }
  return result;
}

export async function runRepoBackfill(options: { limit?: number } = {}, dependencies: RepoBackfillDependencies = defaultDependencies): Promise<BackfillReport> {
  await assertRepoBackfillMutationTarget(dependencies);
  if (!dependencies.storageConfigured()) throw new Error("S3 is not configured; repository backfill cannot read source objects");
  const report: BackfillReport = {
    candidates: 0,
    migrated: 0,
    filesCommitted: 0,
    filesAlreadyPresent: 0,
    filesMissingInS3: [],
    hashMismatches: [],
    errors: [],
  };
  const pending = await fetchPendingProjects(options.limit ?? 500, dependencies);
  report.candidates = pending.length;
  for (const project of pending) {
    try {
      const result = await migrateOneProject(project, dependencies);
      if (result.migrated) report.migrated += 1;
      report.filesCommitted += result.filesCommitted;
      report.filesAlreadyPresent += result.filesAlreadyPresent;
      report.filesMissingInS3.push(...result.filesMissingInS3);
      report.hashMismatches.push(...result.hashMismatches);
    } catch (error) {
      report.errors.push({ projectId: project.id, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return report;
}

export async function verifyRepoBackfill(options: { limit?: number } = {}, dependencies: RepoBackfillDependencies = defaultDependencies): Promise<VerificationReport> {
  if (!dependencies.storageConfigured()) throw new Error("S3 is not configured; verification cannot compare source objects");
  const report: VerificationReport = {
    projectsChecked: 0,
    filesChecked: 0,
    filesMissingInGit: [],
    filesMissingInS3: [],
    gitHashMismatches: [],
    s3HashMismatches: [],
    errors: [],
  };
  const migrated = await fetchMigratedProjects(options.limit ?? 100000, dependencies);
  for (const project of migrated) {
    report.projectsChecked += 1;
    try {
      const repoPath = absoluteRepoPath(project.repo_path);
      const files = await fetchGitBackedFiles(project.id, dependencies);
      for (const file of files) {
        report.filesChecked += 1;
        const filePath = repoFilePath(file.role, file.craft, filenameForFile(file));
        const gitContent = await dependencies.readFileContent(repoPath, filePath);
        if (!gitContent) report.filesMissingInGit.push(file.id);
        else if (!createHash("sha256").update(gitContent).digest().equals(file.checksum)) report.gitHashMismatches.push(file.id);

        if (file.s3_key === null) {
          report.filesMissingInS3.push(file.id);
          continue;
        }
        const stream = await dependencies.getObjectStream(file.s3_key);
        if (!stream) {
          report.filesMissingInS3.push(file.id);
          continue;
        }
        const s3Content = await streamToBuffer(stream.body);
        if (!createHash("sha256").update(s3Content).digest().equals(file.checksum)) report.s3HashMismatches.push(file.id);
      }
    } catch (error) {
      report.errors.push({ projectId: project.id, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return report;
}

async function inspectDescriptionCache(
  options: { limit?: number },
  dependencies: RepoBackfillDependencies,
): Promise<{
  projectsChecked: number;
  mismatches: string[];
  errors: { projectId: string; error: string }[];
}> {
  const result = { projectsChecked: 0, mismatches: [] as string[], errors: [] as { projectId: string; error: string }[] };
  for (const project of await fetchMigratedProjects(options.limit ?? 100000, dependencies)) {
    result.projectsChecked += 1;
    try {
      const content = await dependencies.readFileContent(absoluteRepoPath(project.repo_path), "README.md");
      if ((content?.toString("utf8") ?? "") !== (project.description ?? "")) result.mismatches.push(project.id);
    } catch (error) {
      result.errors.push({ projectId: project.id, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return result;
}

export async function reconcileDescriptionCache(options: { limit?: number } = {}, dependencies: RepoBackfillDependencies = defaultDependencies): Promise<DescriptionCacheReport> {
  await assertRepoBackfillMutationTarget(dependencies);
  const report: DescriptionCacheReport = { projectsChecked: 0, reconciled: [], errors: [] };
  for (const project of await fetchMigratedProjects(options.limit ?? 100000, dependencies)) {
    report.projectsChecked += 1;
    try {
      const content = await dependencies.readFileContent(absoluteRepoPath(project.repo_path), "README.md");
      const readme = content?.toString("utf8") ?? "";
      if (readme !== (project.description ?? "")) {
        await dependencies.database.query(`update projects set description = $2 where id = $1`, [project.id, readme]);
        report.reconciled.push(project.id);
      }
    } catch (error) {
      report.errors.push({ projectId: project.id, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return report;
}

export async function inspectRepoBackfillCompletion(
  options: { limit?: number } = {},
  dependencies: RepoBackfillDependencies = defaultDependencies,
): Promise<RepoBackfillCompletionReport> {
  const pending = await dependencies.database.query<{ count: string }>(REPO_BACKFILL_COMPLETION_QUERIES.pendingRepositoryMigration);
  const verification = await verifyRepoBackfill(options, dependencies);
  const descriptions = await inspectDescriptionCache(options, dependencies);
  const pendingProjects = Number(pending.rows[0]?.count ?? "0");
  const complete =
    pendingProjects === 0 &&
    verification.filesMissingInGit.length === 0 &&
    verification.filesMissingInS3.length === 0 &&
    verification.gitHashMismatches.length === 0 &&
    verification.s3HashMismatches.length === 0 &&
    verification.errors.length === 0 &&
    descriptions.mismatches.length === 0 &&
    descriptions.errors.length === 0;
  return {
    pendingProjects,
    verification,
    descriptionCacheMismatches: descriptions.mismatches,
    descriptionCacheErrors: descriptions.errors,
    complete,
  };
}
