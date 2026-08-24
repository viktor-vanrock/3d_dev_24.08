import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { withRepoLock } from "./lock.ts";

// MF-1965: закрывает открытый вопрос из спайка lock.ts — «нет детекции зависшего лока от
// упавшего процесса». Лок-файл теперь несёт {pid, acquiredAt}; withRepoLock крадёт его, если
// pid мёртв (тот же хост) или он старше TTL, вместо ожидания deadline.

let workDir: string;

beforeEach(async () => {
  workDir = await mkdtemp(path.join(tmpdir(), "portal-git-lock-"));
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

describe("withRepoLock — stale lock recovery", () => {
  it("steals a lock held by a pid that no longer exists on this host, without waiting for the deadline", async () => {
    const repoPath = path.join(workDir, "repo");
    await mkdir(repoPath, { recursive: true });
    // A pid essentially guaranteed not to be alive (PIDs wrap well below this on Linux).
    await writeFile(path.join(repoPath, "portal.lock"), JSON.stringify({ pid: 999999, acquiredAt: Date.now() }));

    const start = Date.now();
    const result = await withRepoLock(repoPath, async () => "ran", 5000);
    expect(result).toBe("ran");
    expect(Date.now() - start).toBeLessThan(1000); // stolen immediately, did not wait out the 5s deadline
  });

  it("steals a lock older than the TTL even if its pid happens to be alive (cross-host safety net)", async () => {
    const repoPath = path.join(workDir, "repo-ttl");
    await mkdir(repoPath, { recursive: true });
    // process.pid is definitely alive (it's us) — only the TTL check should trigger the steal.
    await writeFile(path.join(repoPath, "portal.lock"), JSON.stringify({ pid: process.pid, acquiredAt: Date.now() - 120_000 }));

    const start = Date.now();
    const result = await withRepoLock(repoPath, async () => "ran", 5000);
    expect(result).toBe("ran");
    expect(Date.now() - start).toBeLessThan(1000);
  });

  it("does NOT steal a fresh lock held by a live pid — normal contention still waits/times out", async () => {
    const repoPath = path.join(workDir, "repo-live");
    await mkdir(repoPath, { recursive: true });
    await writeFile(path.join(repoPath, "portal.lock"), JSON.stringify({ pid: process.pid, acquiredAt: Date.now() }));

    await expect(withRepoLock(repoPath, async () => "ran", 100)).rejects.toThrow();
  });

  it("treats a malformed lock file as stale and steals it", async () => {
    const repoPath = path.join(workDir, "repo-malformed");
    await mkdir(repoPath, { recursive: true });
    await writeFile(path.join(repoPath, "portal.lock"), "not json");

    const result = await withRepoLock(repoPath, async () => "ran", 5000);
    expect(result).toBe("ran");
  });

  it("writes {pid, acquiredAt} into the lock file while held, and removes it on release", async () => {
    const repoPath = path.join(workDir, "repo-content");
    await mkdir(repoPath, { recursive: true });
    const lockPath = path.join(repoPath, "portal.lock");

    let seenContent: unknown;
    await withRepoLock(repoPath, async () => {
      seenContent = JSON.parse(await readFile(lockPath, "utf8"));
    });

    expect(seenContent).toMatchObject({ pid: process.pid });
    await expect(readFile(lockPath, "utf8")).rejects.toThrow(); // released
  });
});
