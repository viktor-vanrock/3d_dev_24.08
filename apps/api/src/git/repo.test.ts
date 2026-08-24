import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { assertFileSizeAllowed, assertRepoSizeBytesAllowed, FileTooLargeError, MAX_FILE_BYTES, RepoTooLargeError } from "./limits.ts";
import { RepoLockTimeoutError, withRepoLock } from "./lock.ts";
import { access } from "node:fs/promises";
import { commitFile, commitMarker, commitReadme, forkRepo, GitPathConflictError, initBareRepo, log, readFileContent, readTree, removeFile, removeRepo } from "./repo.ts";

const author = { name: "Portal Bot", email: "bot@3mf.tech" };

let workDir: string;

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((fulfill) => {
    resolve = fulfill;
  });
  return { promise, resolve };
}

beforeEach(async () => {
  workDir = await mkdtemp(path.join(tmpdir(), "portal-git-"));
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

// Критерий приёмки MF-515 п.1: init → commit файла → commit README → read-tree → log → clone-форк
// на одном тестовом bare-репо.
describe("git module — full lifecycle on a bare repo", () => {
  it("runs init, commit(file+README), read-tree, log and fork end to end", async () => {
    const repoPath = path.join(workDir, "project.git");
    await initBareRepo(repoPath);

    const sourceSha = await commitFile(repoPath, {
      filePath: "print/model.stl",
      content: Buffer.from("solid test\nendsolid test\n"),
      message: "feat: add source file",
      author,
    });
    expect(sourceSha).toMatch(/^[0-9a-f]{40}$/);

    const readmeSha = await commitReadme(repoPath, "# Test project\n\nDescription.", author);
    expect(readmeSha).toMatch(/^[0-9a-f]{40}$/);
    expect(readmeSha).not.toBe(sourceSha);

    const tree = await readTree(repoPath);
    const paths = tree.map((entry) => entry.path).sort();
    expect(paths).toEqual(["README.md", "print/model.stl"]);
    const readmeEntry = tree.find((entry) => entry.path === "README.md");
    expect(readmeEntry?.type).toBe("blob");
    expect(readmeEntry?.sizeBytes).toBe(Buffer.byteLength("# Test project\n\nDescription."));

    const history = await log(repoPath);
    expect(history).toHaveLength(2);
    expect(history[0]?.sha).toBe(readmeSha); // newest first
    expect(history[1]?.sha).toBe(sourceSha);
    expect(history[0]?.authorEmail).toBe(author.email);
    expect(history[0]?.subject).toBe("docs: update README");

    const forkPath = path.join(workDir, "fork.git");
    await forkRepo(repoPath, forkPath);
    const forkedTree = await readTree(forkPath);
    expect(forkedTree.map((e) => e.path).sort()).toEqual(paths);
    const forkedHistory = await log(forkPath);
    expect(forkedHistory.map((e) => e.sha)).toEqual(history.map((e) => e.sha));
  });

  it("returns empty tree/log for a freshly initialized repo (unborn branch)", async () => {
    const repoPath = path.join(workDir, "empty.git");
    await initBareRepo(repoPath);

    expect(await readTree(repoPath)).toEqual([]);
    expect(await log(repoPath)).toEqual([]);
  });

  it("keeps prior files when committing a second file (index seeded from parent tree)", async () => {
    const repoPath = path.join(workDir, "project.git");
    await initBareRepo(repoPath);

    await commitFile(repoPath, {
      filePath: "docs/notes.md",
      content: Buffer.from("first"),
      message: "chore: first file",
      author,
    });
    await commitFile(repoPath, {
      filePath: "docs/other.md",
      content: Buffer.from("second"),
      message: "chore: second file",
      author,
    });

    const tree = await readTree(repoPath);
    expect(tree.map((e) => e.path).sort()).toEqual(["docs/notes.md", "docs/other.md"]);
  });

  it("rejects unsafe file paths", async () => {
    const repoPath = path.join(workDir, "project.git");
    await initBareRepo(repoPath);

    await expect(
      commitFile(repoPath, {
        filePath: "../escape.txt",
        content: Buffer.from("x"),
        message: "bad",
        author,
      }),
    ).rejects.toThrow(/недопустимый путь/);
  });

  it("ifAbsent rejects with GitPathConflictError when the path is already tracked (MF-1965 CAS)", async () => {
    const repoPath = path.join(workDir, "project.git");
    await initBareRepo(repoPath);

    await commitFile(repoPath, {
      filePath: "print/model.stl",
      content: Buffer.from("first"),
      message: "feat: add source",
      author,
    });

    await expect(
      commitFile(repoPath, {
        filePath: "print/model.stl",
        content: Buffer.from("second, different file entirely"),
        message: "feat: add aux with a colliding path",
        author,
        ifAbsent: true,
      }),
    ).rejects.toThrow(GitPathConflictError);

    // The conflicting write must not have landed — original content survives.
    const content = await readFileContent(repoPath, "print/model.stl");
    expect(content?.toString("utf8")).toBe("first");
  });

  it("ifAbsent allows the write when the path is free, and allows overwrite without the flag", async () => {
    const repoPath = path.join(workDir, "project.git");
    await initBareRepo(repoPath);

    await commitFile(repoPath, {
      filePath: "print/new.stl",
      content: Buffer.from("v1"),
      message: "feat: add",
      author,
      ifAbsent: true,
    });
    // Without ifAbsent, re-committing the same path is still a normal overwrite (re-upload flow).
    await commitFile(repoPath, {
      filePath: "print/new.stl",
      content: Buffer.from("v2"),
      message: "feat: replace",
      author,
    });

    const content = await readFileContent(repoPath, "print/new.stl");
    expect(content?.toString("utf8")).toBe("v2");
  });
});

// Конкурентные записи (критерий приёмки п.3): N параллельных коммитов в один и тот же
// репозиторий не должны терять чужие изменения — лок сериализует read-tree/write-tree.
describe("concurrent commits to the same repo", () => {
  it("serializes writes so every file survives", async () => {
    const repoPath = path.join(workDir, "project.git");
    await initBareRepo(repoPath);

    const writers = Array.from({ length: 8 }, (_, i) =>
      commitFile(repoPath, {
        filePath: `files/file-${i}.txt`,
        content: Buffer.from(`content ${i}`),
        message: `feat: add file ${i}`,
        author,
      }),
    );
    const shas = await Promise.all(writers);
    expect(new Set(shas).size).toBe(8); // все коммиты разные, ни один не потерян/перезаписан

    const tree = await readTree(repoPath);
    expect(tree).toHaveLength(8);

    const history = await log(repoPath);
    expect(history).toHaveLength(8);
  });
});

describe("withRepoLock", () => {
  it("runs a second acquisition only after the first releases", async () => {
    const repoPath = path.join(workDir, "lock-test");
    await initBareRepo(repoPath);

    const order: string[] = [];
    const firstAcquired = deferred();
    const releaseFirst = deferred();
    const first = withRepoLock(repoPath, async () => {
      order.push("first-start");
      firstAcquired.resolve();
      await releaseFirst.promise;
      order.push("first-end");
    });
    await firstAcquired.promise;

    const second = withRepoLock(repoPath, async () => {
      order.push("second-start");
      order.push("second-end");
    });

    releaseFirst.resolve();
    await Promise.all([first, second]);
    expect(order).toEqual(["first-start", "first-end", "second-start", "second-end"]);
  });

  it("times out if the lock cannot be acquired in time", async () => {
    const repoPath = path.join(workDir, "lock-timeout");
    await initBareRepo(repoPath);

    const holderAcquired = deferred();
    const releaseHolder = deferred();
    const holder = withRepoLock(repoPath, async () => {
      holderAcquired.resolve();
      await releaseHolder.promise;
    });
    await holderAcquired.promise;

    try {
      await expect(withRepoLock(repoPath, async () => {}, 50)).rejects.toThrow(RepoLockTimeoutError);
    } finally {
      releaseHolder.resolve();
      await holder;
    }
  });
});

// readFileContent/removeRepo — добавлены стейджем 2 (MF-519) поверх контракта спайка:
// GET /readme нужно реальное содержимое блоба, не только метаданные readTree; removeRepo
// откатывает неудачный init/commit и чистит репо при удалении проекта.
describe("readFileContent", () => {
  it("returns the blob content of a committed file", async () => {
    const repoPath = path.join(workDir, "readme.git");
    await initBareRepo(repoPath);
    await commitReadme(repoPath, "# Hello\n\nWorld.", author);

    const content = await readFileContent(repoPath, "README.md");
    expect(content?.toString("utf8")).toBe("# Hello\n\nWorld.");
  });

  it("returns null for a missing file or an unborn branch", async () => {
    const repoPath = path.join(workDir, "empty-readme.git");
    await initBareRepo(repoPath);

    expect(await readFileContent(repoPath, "README.md")).toBeNull();

    await commitFile(repoPath, { filePath: "print/model.stl", content: Buffer.from("x"), message: "feat: add", author });
    expect(await readFileContent(repoPath, "README.md")).toBeNull();
  });
});

describe("removeRepo", () => {
  it("deletes the repo directory from disk", async () => {
    const repoPath = path.join(workDir, "to-remove.git");
    await initBareRepo(repoPath);
    await expect(access(repoPath)).resolves.toBeUndefined();

    await removeRepo(repoPath);
    await expect(access(repoPath)).rejects.toThrow();
  });

  it("is a no-op for a path that does not exist", async () => {
    await expect(removeRepo(path.join(workDir, "never-existed.git"))).resolves.toBeUndefined();
  });
});

// removeFile — стейдж MF-339 шаг 2 (DELETE /models/:id/files/:fileId): тот же plumbing-приём,
// что commitFile, но по force-remove из индекса вместо hash-object+add.
describe("removeFile", () => {
  it("removes a tracked file, keeps the rest, and returns a new commit sha", async () => {
    const repoPath = path.join(workDir, "remove.git");
    await initBareRepo(repoPath);
    await commitFile(repoPath, { filePath: "print/keep.stl", content: Buffer.from("keep"), message: "feat: add keep", author });
    const addSha = await commitFile(repoPath, { filePath: "print/gone.stl", content: Buffer.from("gone"), message: "feat: add gone", author });

    const removeSha = await removeFile(repoPath, { filePath: "print/gone.stl", message: "chore: remove gone", author });
    expect(removeSha).toMatch(/^[0-9a-f]{40}$/);
    expect(removeSha).not.toBe(addSha);

    const tree = await readTree(repoPath);
    expect(tree.map((e) => e.path)).toEqual(["print/keep.stl"]);

    const history = await log(repoPath);
    expect(history).toHaveLength(3); // keep + gone + remove
    expect(history[0]?.subject).toBe("chore: remove gone");
  });

  it("returns null (no-op, no commit) for an unborn branch", async () => {
    const repoPath = path.join(workDir, "remove-empty.git");
    await initBareRepo(repoPath);

    expect(await removeFile(repoPath, { filePath: "print/nothing.stl", message: "chore: remove", author })).toBeNull();
    expect(await log(repoPath)).toEqual([]);
  });

  it("returns null (idempotent) when the path is already gone from the tree", async () => {
    const repoPath = path.join(workDir, "remove-twice.git");
    await initBareRepo(repoPath);
    await commitFile(repoPath, { filePath: "print/once.stl", content: Buffer.from("x"), message: "feat: add", author });

    const first = await removeFile(repoPath, { filePath: "print/once.stl", message: "chore: remove", author });
    expect(first).toMatch(/^[0-9a-f]{40}$/);

    const second = await removeFile(repoPath, { filePath: "print/once.stl", message: "chore: remove again", author });
    expect(second).toBeNull();

    const history = await log(repoPath);
    expect(history).toHaveLength(2); // add + first remove, second remove was a no-op
  });

  it("rejects unsafe file paths", async () => {
    const repoPath = path.join(workDir, "remove-unsafe.git");
    await initBareRepo(repoPath);

    await expect(removeFile(repoPath, { filePath: "../escape.txt", message: "bad", author })).rejects.toThrow(/недопустимый путь/);
  });
});

describe("commitMarker", () => {
  it("adds an event-only commit that keeps the tree identical to its parent", async () => {
    const repoPath = path.join(workDir, "marker.git");
    await initBareRepo(repoPath);
    const sourceSha = await commitFile(repoPath, { filePath: "print/model.stl", content: Buffer.from("x"), message: "feat: add source file", author });

    const forkAuthor = { name: "new-owner", email: "new-owner@users.3mf.tech" };
    const markerSha = await commitMarker(repoPath, "Форк проекта Original", forkAuthor);
    expect(markerSha).toMatch(/^[0-9a-f]{40}$/);
    expect(markerSha).not.toBe(sourceSha);

    const tree = await readTree(repoPath);
    expect(tree.map((e) => e.path)).toEqual(["print/model.stl"]);

    const history = await log(repoPath);
    expect(history).toHaveLength(2);
    expect(history[0]?.sha).toBe(markerSha);
    expect(history[0]?.subject).toBe("Форк проекта Original");
    expect(history[0]?.authorEmail).toBe(forkAuthor.email);
    expect(history[1]?.sha).toBe(sourceSha);
  });

  it("rejects an unborn branch — nothing to put a marker on", async () => {
    const repoPath = path.join(workDir, "marker-empty.git");
    await initBareRepo(repoPath);

    await expect(commitMarker(repoPath, "Форк проекта Original", author)).rejects.toThrow(/пуст/);
  });
});

describe("limits", () => {
  it("allows a file exactly at the limit, rejects one byte over", () => {
    expect(() => assertFileSizeAllowed(MAX_FILE_BYTES)).not.toThrow();
    expect(() => assertFileSizeAllowed(MAX_FILE_BYTES + 1)).toThrow(FileTooLargeError);
  });

  it("rejects a repo over the size limit", () => {
    expect(() => assertRepoSizeBytesAllowed(1024)).not.toThrow();
    expect(() => assertRepoSizeBytesAllowed(2 * 1024 * 1024 * 1024)).toThrow(RepoTooLargeError);
  });
});
