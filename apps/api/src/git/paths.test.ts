import { afterEach, describe, expect, it } from "vitest";
import { absoluteRepoPath, gitAuthorForUser, repoDirNameForModel, repoFilePath, repoFolderForRole } from "./paths.ts";

// Резолвинг projectId → repoPath и маппинг роль/craft → папка репо (Data+Design, MF-519
// стейдж 2, docs/epics/project.git.md §10.2).

describe("absoluteRepoPath / repoDirNameForModel", () => {
  afterEach(() => {
    delete process.env.GIT_REPOS_DIR;
  });

  it("defaults to /srv/git/repos (MF-518)", () => {
    delete process.env.GIT_REPOS_DIR;
    expect(absoluteRepoPath("abc")).toBe("/srv/git/repos/abc");
  });

  it("honors GIT_REPOS_DIR override", () => {
    process.env.GIT_REPOS_DIR = "/tmp/portal-git-test";
    expect(absoluteRepoPath("abc")).toBe("/tmp/portal-git-test/abc");
  });

  it("uses the model id as the repo dir name (docs/infra/git-repos.md)", () => {
    expect(repoDirNameForModel("11111111-1111-1111-1111-111111111111")).toBe("11111111-1111-1111-1111-111111111111");
  });
});

describe("repoFolderForRole (project.git.md §10.2)", () => {
  it("maps source/aux via project craft, defaulting to print/", () => {
    expect(repoFolderForRole("source", "3d_printing")).toBe("print");
    expect(repoFolderForRole("aux", "3d_printing")).toBe("print");
  });

  it("routes cnc_program and drawing to the shared cad/ folder", () => {
    expect(repoFolderForRole("cnc_program", "cnc")).toBe("cad");
    expect(repoFolderForRole("drawing", "cnc")).toBe("cad");
  });

  it("routes gerber to pcb/ and code_archive to code/", () => {
    expect(repoFolderForRole("gerber", "electronics")).toBe("pcb");
    expect(repoFolderForRole("code_archive", "software")).toBe("code");
  });

  it("routes project_doc to docs/ regardless of craft (§10.2.3)", () => {
    expect(repoFolderForRole("project_doc", "3d_printing")).toBe("docs");
    expect(repoFolderForRole("project_doc", "cnc")).toBe("docs");
  });
});

describe("repoFilePath", () => {
  it("joins folder + basename, stripping any client-supplied directories", () => {
    expect(repoFilePath("source", "3d_printing", "model.stl")).toBe("print/model.stl");
    expect(repoFilePath("source", "3d_printing", "../../etc/passwd")).toBe("print/passwd");
    expect(repoFilePath("source", "3d_printing", "/abs/path/model.stl")).toBe("print/model.stl");
  });

  it("falls back to a generic name for an empty filename", () => {
    expect(repoFilePath("source", "3d_printing", "")).toBe("print/file");
  });
});

describe("gitAuthorForUser", () => {
  it("builds a stable synthetic author from the session username", () => {
    expect(gitAuthorForUser({ id: "u1", username: "alice" })).toEqual({
      name: "alice",
      email: "alice@users.3mf.tech",
    });
  });
});
