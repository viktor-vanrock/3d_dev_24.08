import { describe, expect, it } from "vitest";
import { analyzeProjectSource } from "./projectsource.ts";

function projectFile(path: string, content = "x"): File {
  const name = path.split("/").at(-1) ?? path;
  const file = new File([content], name);
  Object.defineProperty(file, "webkitRelativePath", { value: path });
  return file;
}

describe("analyzeProjectSource", () => {
  it("keeps a single STL simple", () => {
    const result = analyzeProjectSource([projectFile("lamp.stl")]);
    expect(result.level).toBe("simple");
    expect(result.primary?.name).toBe("lamp.stl");
    expect(result.title).toBe("lamp");
    expect(result.shouldArchive).toBe(false);
  });

  it("recognises a multipart kit and keeps the folder name as title", () => {
    const result = analyzeProjectSource([
      projectFile("robot/print/base.stl"),
      projectFile("robot/print/arm.stl"),
      projectFile("robot/cad/bracket.step"),
    ]);
    expect(result.level).toBe("kit");
    expect(result.title).toBe("robot");
    expect(result.shouldArchive).toBe(true);
  });

  it("raises complexity when code or electronics are present", () => {
    const result = analyzeProjectSource([
      projectFile("arm/print/base.3mf"),
      projectFile("arm/code/controller.py"),
      projectFile("arm/pcb/control.kicad_pcb"),
    ]);
    expect(result.level).toBe("smart");
    expect(result.signals.map((signal) => signal.id)).toEqual(expect.arrayContaining(["code", "pcb"]));
  });

  it("recognises a Portal-prepared make folder", () => {
    const result = analyzeProjectSource([
      projectFile("arm/print/base.stl"),
      projectFile("arm/README.md", "root"),
      projectFile("arm/make/README.md", "landing"),
      projectFile("arm/make/media/hero.webp"),
    ]);
    expect(result.level).toBe("prepared");
    expect(result.hasMakeReadme).toBe(true);
    expect(result.readme ? result.readme.name : null).toBe("README.md");
    expect(result.readme ? result.readme.size : 0).toBe("landing".length);
  });

  it("recognises the canonical manifest and ignores .git internals", () => {
    const result = analyzeProjectSource([
      projectFile("arm/portal.project.yaml"),
      projectFile("arm/print/base.stl"),
      projectFile("arm/.git/config"),
      projectFile("arm/.DS_Store"),
    ]);
    expect(result.level).toBe("prepared");
    expect(result.hasPortalManifest).toBe(true);
    expect(result.files).toHaveLength(2);
  });

  it("selects 3MF before STL and archives", () => {
    const result = analyzeProjectSource([
      projectFile("robot/print/a.stl"),
      projectFile("robot/print/layout.3mf"),
      projectFile("robot/project.zip"),
    ]);
    expect(result.primary?.name).toBe("layout.3mf");
  });
});
