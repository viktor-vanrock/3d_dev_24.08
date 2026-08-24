import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { stringify } from "yaml";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { absoluteRepoPath } from "../../../git/paths.ts";
import { commitFile, initBareRepo } from "../../../git/repo.ts";
import { resolvePinnedArtifact, ResolvePinnedArtifactError } from "./projectSliceSource.ts";

// Fixture — та же форма, что packages/contracts/http/fixtures/project.manifest.v1.lerobotdepot.json
// (project-code.v1), урезанная до одной конфигурации/шага/артефакта под нужды этого теста.
const FOLLOWER_STL = Buffer.from("solid follower\nfacet normal 0 0 1\nendfacet\nendsolid follower\n", "utf8");
const FOLLOWER_SHA256 = createHash("sha256").update(FOLLOWER_STL).digest("hex");

function manifestYaml(): string {
  return stringify({
    schema: "https://schemas.3mf.tech/project/v1",
    project: {
      uid: "lerobotdepot",
      title: "LeRobotDepot SO-101 Arm",
      "default-configuration": "so101-pair",
      units: { length: "mm", coordinates: "right-handed-z-up" },
    },
    artifacts: {
      "follower-print": { path: "print/SO101/follower.3mf", kind: "print-model" },
      "firmware-code": { path: "code/firmware.tar.gz", kind: "firmware" },
    },
    configurations: {
      "so101-pair": {
        title: "Пара SO-101",
        artifacts: ["follower-print", "firmware-code"],
        workflow: "pair-build",
      },
    },
    workflows: {
      "pair-build": {
        phases: { print: { type: "print", steps: ["print-follower"] } },
        steps: { "print-follower": { title: "Напечатайте follower" } },
      },
    },
  });
}

describe("resolvePinnedArtifact (project-slice-request.v1)", () => {
  let workDir: string;
  let repoPath: string;
  let commitSha: string;

  beforeAll(async () => {
    workDir = await mkdtemp(path.join(tmpdir(), "portal-slice-source-"));
    process.env.GIT_REPOS_DIR = workDir;
    repoPath = absoluteRepoPath("repo-under-test");
    await initBareRepo(repoPath);
    await commitFile(repoPath, {
      filePath: "portal.project.yaml",
      content: Buffer.from(manifestYaml(), "utf8"),
      message: "manifest",
      author: { name: "tester", email: "tester@users.3mf.tech" },
    });
    commitSha = await commitFile(repoPath, {
      filePath: "print/SO101/follower.3mf",
      content: FOLLOWER_STL,
      message: "artifact",
      author: { name: "tester", email: "tester@users.3mf.tech" },
    });
  });

  afterAll(async () => {
    delete process.env.GIT_REPOS_DIR;
    await rm(workDir, { recursive: true, force: true });
  });

  const baseSource = () => ({
    revision: commitSha,
    configuration_id: "so101-pair",
    workflow_step_id: "print-follower",
    artifact_id: "follower-print",
    artifact_sha256: FOLLOWER_SHA256,
  });

  it("resolves the pinned artifact bytes and recomputes sha256", async () => {
    const result = await resolvePinnedArtifact(repoPath, baseSource());
    expect(result.path).toBe("print/SO101/follower.3mf");
    expect(result.kind).toBe("print-model");
    expect(result.sha256).toBe(FOLLOWER_SHA256);
    expect(result.bytes.equals(FOLLOWER_STL)).toBe(true);
  });

  it("rejects a claimed sha256 that does not match the real bytes (TOCTOU guard)", async () => {
    await expect(resolvePinnedArtifact(repoPath, { ...baseSource(), artifact_sha256: "0".repeat(64) })).rejects.toMatchObject({ code: "SOURCE_ARTIFACT_MISMATCH" });
  });

  it("rejects an artifact kind that is not sliceable print geometry", async () => {
    await expect(
      resolvePinnedArtifact(repoPath, {
        ...baseSource(),
        artifact_id: "firmware-code",
        artifact_sha256: "1".repeat(64),
      }),
    ).rejects.toMatchObject({ code: "SOURCE_ROLE_UNSUPPORTED" });
  });

  it("rejects an artifact_id not listed under the given configuration", async () => {
    await expect(resolvePinnedArtifact(repoPath, { ...baseSource(), configuration_id: "unknown-config" })).rejects.toMatchObject({ code: "SOURCE_NOT_FOUND" });
  });

  it("rejects a workflow_step_id that does not exist in the configuration's workflow", async () => {
    await expect(resolvePinnedArtifact(repoPath, { ...baseSource(), workflow_step_id: "not-a-step" })).rejects.toMatchObject({ code: "SOURCE_NOT_FOUND" });
  });

  it("rejects a revision with no portal.project.yaml at all", async () => {
    const emptyRepoPath = absoluteRepoPath("repo-without-manifest");
    await initBareRepo(emptyRepoPath);
    const sha = await commitFile(emptyRepoPath, {
      filePath: "README.md",
      content: Buffer.from("# empty\n"),
      message: "init",
      author: { name: "tester", email: "tester@users.3mf.tech" },
    });
    await expect(resolvePinnedArtifact(emptyRepoPath, { ...baseSource(), revision: sha })).rejects.toBeInstanceOf(ResolvePinnedArtifactError);
  });
});
