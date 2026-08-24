import { mkdtemp, rm, writeFile, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GitOutputTooLargeError, GitTimeoutError, runGit } from "./gitcli.ts";

// MF-1965: runGit раньше не имело ни таймаута на дочерний процесс, ни потолка на stdout/stderr —
// зависший/раздутый git-процесс держал бы event loop/память apps/api неограниченно. Тесты
// подменяют `git` на фейковый shell-шим через PATH (единственный детерминированный способ
// заставить настоящий дочерний процесс либо зависнуть, либо выдать много байт по требованию).

let shimDir: string;

beforeEach(async () => {
  shimDir = await mkdtemp(path.join(tmpdir(), "portal-gitcli-shim-"));
});

afterEach(async () => {
  await rm(shimDir, { recursive: true, force: true });
});

async function installShim(script: string): Promise<NodeJS.ProcessEnv> {
  const shimPath = path.join(shimDir, "git");
  await writeFile(shimPath, `#!/bin/sh\n${script}\n`);
  await chmod(shimPath, 0o755);
  return { ...process.env, PATH: `${shimDir}:${process.env.PATH}` };
}

describe("runGit — timeout hardening", () => {
  it("kills a hung child process and rejects with GitTimeoutError instead of hanging forever", async () => {
    const env = await installShim("sleep 5\nexit 0");
    const start = Date.now();
    await expect(runGit(["status"], { env, timeoutMs: 150 })).rejects.toThrow(GitTimeoutError);
    expect(Date.now() - start).toBeLessThan(2000); // killed well before the shim's own 5s sleep would finish
  });

  it("still succeeds normally for a fast command under the timeout", async () => {
    const env = await installShim("printf %s hello\nexit 0");
    const result = await runGit(["status"], { env, timeoutMs: 5000 });
    expect(result.stdout.toString("utf8")).toBe("hello");
  });
});

describe("runGit — output cap hardening", () => {
  it("kills the child and rejects with GitOutputTooLargeError when stdout exceeds the cap", async () => {
    const env = await installShim("yes AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA | head -c 1000000\nexit 0");
    await expect(runGit(["status"], { env, maxOutputBytes: 1000 })).rejects.toThrow(GitOutputTooLargeError);
  });

  it("kills the child and rejects with GitOutputTooLargeError when stderr exceeds the cap", async () => {
    const env = await installShim("yes AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA | head -c 1000000 >&2\nexit 0");
    await expect(runGit(["status"], { env, maxOutputBytes: 1000 })).rejects.toThrow(GitOutputTooLargeError);
  });

  it("allows output right up under the cap", async () => {
    const env = await installShim("head -c 500 /dev/zero\nexit 0");
    const result = await runGit(["status"], { env, maxOutputBytes: 1000 });
    expect(result.stdout.length).toBe(500);
  });
});
