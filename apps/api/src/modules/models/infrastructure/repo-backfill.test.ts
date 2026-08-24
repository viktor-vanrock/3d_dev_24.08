import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import {
  REPO_BACKFILL_COMPLETION_QUERIES,
  assertRepoBackfillMutationTarget,
  reconcileDescriptionCache,
  runRepoBackfill,
  verifyRepoBackfill,
  type RepoBackfillDependencies,
} from "./repo-backfill.ts";

function dependencies(query: (text: string, values?: unknown[]) => Promise<{ rows: unknown[] }>, env: NodeJS.ProcessEnv = {}): RepoBackfillDependencies {
  return {
    database: { query } as RepoBackfillDependencies["database"],
    storageConfigured: vi.fn(() => true),
    getObjectStream: vi.fn(async () => ({ body: Readable.from([Buffer.from("source")]) })),
    initBareRepo: vi.fn(async () => undefined),
    readTree: vi.fn(async () => []),
    readFileContent: vi.fn(async () => null),
    commitFile: vi.fn(async () => "commit"),
    commitReadme: vi.fn(async () => "commit"),
    env,
  };
}

describe("repository backfill current-schema contract", () => {
  it("defines repository completion queries against projects, not legacy model metadata", () => {
    expect(REPO_BACKFILL_COMPLETION_QUERIES.pendingRepositoryMigration).toContain("from projects");
    expect(REPO_BACKFILL_COMPLETION_QUERIES.migratedProjects).toContain("from projects");
    expect(Object.values(REPO_BACKFILL_COMPLETION_QUERIES).join(" ")).not.toMatch(/models\.(?:repo_path|description)/);
  });

  it("requires an exact target database before a mutating run", async () => {
    const query = vi.fn(async () => ({ rows: [{ db: "portal_prod" }] }));
    const deps = dependencies(query, { DATABASE_URL: "postgres://portal_prod", BACKFILL_REPOS_DB_NAME: "portal_dev" });

    await expect(runRepoBackfill({}, deps)).rejects.toThrow("does not match BACKFILL_REPOS_DB_NAME");
    expect(query).toHaveBeenCalledTimes(1);
    expect(deps.initBareRepo).not.toHaveBeenCalled();
    expect(deps.commitFile).not.toHaveBeenCalled();
    expect(deps.commitReadme).not.toHaveBeenCalled();
  });

  it("rejects a mutating run with no explicit database confirmation before querying", async () => {
    const query = vi.fn(async () => ({ rows: [{ db: "portal_dev" }] }));
    const deps = dependencies(query, { DATABASE_URL: "postgres://portal_dev" });

    await expect(assertRepoBackfillMutationTarget(deps)).rejects.toThrow("BACKFILL_REPOS_DB_NAME must explicitly name");
    expect(query).not.toHaveBeenCalled();
  });

  it("migrates project metadata and current child revision files", async () => {
    const checksum = createHash("sha256").update("source").digest();
    const statements: string[] = [];
    const query = vi.fn(async (text: string) => {
      statements.push(text);
      if (text.includes("current_database()")) return { rows: [{ db: "portal_dev" }] };
      if (text.includes("from projects p")) {
        return { rows: [{ id: "project-1", description: "README", owner_id: "owner-1", owner_username: "owner" }] };
      }
      if (text.includes("from models m")) {
        return {
          rows: [{ id: "file-1", role: "source", s3_key: "protected/models/project-1/source.stl", original_filename: "part.stl", checksum, craft: "3d_printing" }],
        };
      }
      return { rows: [] };
    });
    const deps = dependencies(query, {
      DATABASE_URL: "postgres://portal_dev",
      BACKFILL_REPOS_DB_NAME: "portal_dev",
    });

    const report = await runRepoBackfill({ limit: 1 }, deps);

    expect(report).toMatchObject({ candidates: 1, migrated: 1, filesCommitted: 1, errors: [] });
    expect(statements.join("\n")).toContain("join model_revision_files");
    expect(statements.join("\n")).toContain("left join storage_blobs");
    expect(statements).toContainEqual(expect.stringContaining("update projects set repo_path"));
    expect(statements.join("\n")).not.toMatch(/update models set repo_path/);
    expect(deps.commitFile).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ filePath: "print/part.stl", content: Buffer.from("source") }));
  });

  it("does not mark a project migrated when S3 disagrees even if Git already matches", async () => {
    const checksum = createHash("sha256").update("source").digest();
    const statements: string[] = [];
    const query = vi.fn(async (text: string) => {
      statements.push(text);
      if (text.includes("current_database()")) return { rows: [{ db: "portal_dev" }] };
      if (text.includes("from projects p")) return { rows: [{ id: "project-1", description: null, owner_id: "owner-1", owner_username: "owner" }] };
      if (text.includes("from models m")) {
        return { rows: [{ id: "file-1", role: "source", s3_key: "source.stl", original_filename: "part.stl", checksum, craft: "3d_printing" }] };
      }
      return { rows: [] };
    });
    const deps = dependencies(query, { DATABASE_URL: "postgres://portal_dev", BACKFILL_REPOS_DB_NAME: "portal_dev" });
    deps.readTree = vi.fn(async () => [{ mode: "100644", type: "blob" as const, sha: "abc", path: "print/part.stl", sizeBytes: 6 }]);
    deps.readFileContent = vi.fn(async () => Buffer.from("source"));
    deps.getObjectStream = vi.fn(async () => ({ body: Readable.from([Buffer.from("different")]) }));

    const report = await runRepoBackfill({}, deps);

    expect(report).toMatchObject({ migrated: 0, hashMismatches: ["file-1"] });
    expect(statements.join("\n")).not.toContain("update projects set repo_path");
    expect(deps.commitFile).not.toHaveBeenCalled();
  });

  it("keeps verify-only read-only while comparing Git and S3 hashes", async () => {
    const checksum = createHash("sha256").update("source").digest();
    const statements: string[] = [];
    const query = vi.fn(async (text: string) => {
      statements.push(text);
      if (text.includes("from projects where repo_path is not null")) return { rows: [{ id: "project-1", repo_path: "project-1", description: null }] };
      if (text.includes("from models m")) {
        return {
          rows: [{ id: "file-1", role: "source", s3_key: "protected/models/project-1/source.stl", original_filename: "part.stl", checksum, craft: "3d_printing" }],
        };
      }
      throw new Error(`unexpected query: ${text}`);
    });
    const deps = dependencies(query);
    deps.readFileContent = vi.fn(async () => Buffer.from("source"));

    const report = await verifyRepoBackfill({}, deps);

    expect(report).toMatchObject({
      projectsChecked: 1,
      filesChecked: 1,
      filesMissingInGit: [],
      filesMissingInS3: [],
      gitHashMismatches: [],
      s3HashMismatches: [],
      errors: [],
    });
    expect(statements.every((statement) => /^\s*select\b/i.test(statement))).toBe(true);
    expect(deps.initBareRepo).not.toHaveBeenCalled();
    expect(deps.commitFile).not.toHaveBeenCalled();
    expect(deps.commitReadme).not.toHaveBeenCalled();
  });

  it("reconciles the projects description cache only after target validation", async () => {
    const statements: string[] = [];
    const query = vi.fn(async (text: string) => {
      statements.push(text);
      if (text.includes("current_database()")) return { rows: [{ db: "portal_dev" }] };
      if (text.includes("from projects where repo_path is not null")) return { rows: [{ id: "project-1", repo_path: "project-1", description: "stale" }] };
      return { rows: [] };
    });
    const deps = dependencies(query, {
      DATABASE_URL: "postgres://portal_dev",
      BACKFILL_REPOS_DB_NAME: "portal_dev",
    });
    deps.readFileContent = vi.fn(async () => Buffer.from("current"));

    const report = await reconcileDescriptionCache({}, deps);

    expect(report).toEqual({ projectsChecked: 1, reconciled: ["project-1"], errors: [] });
    expect(statements[0]).toContain("current_database()");
    expect(statements).toContainEqual(expect.stringContaining("update projects set description"));
    expect(statements.join("\n")).not.toMatch(/update models set description/);
  });
});
