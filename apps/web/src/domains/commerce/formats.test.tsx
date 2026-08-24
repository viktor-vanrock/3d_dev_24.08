import { describe, expect, it } from "vitest";
import { classForFilename, classForFormat, isAcceptedExtension } from "./formats.ts";

// Клиентское зеркало формат→класс (§2.1 projects.multiformat.md) — используется только как
// предварительный UI-хинт, финал даёт magic-байт ответ сервера (source_format).
describe("classForFilename", () => {
  it("classifies pipeline formats", () => {
    expect(classForFilename("part.stl")).toBe("pipeline");
    expect(classForFilename("part.obj")).toBe("pipeline");
    expect(classForFilename("part.3mf")).toBe("pipeline");
  });

  it("classifies as-is formats", () => {
    expect(classForFilename("part.step")).toBe("as_is");
    expect(classForFilename("part.stp")).toBe("as_is");
    expect(classForFilename("drawing.dxf")).toBe("as_is");
    expect(classForFilename("drawing.svg")).toBe("as_is");
    expect(classForFilename("toolpath.nc")).toBe("as_is");
    expect(classForFilename("board.gbr")).toBe("as_is");
    expect(classForFilename("firmware.zip")).toBe("as_is");
  });

  it("is case-insensitive and returns null for unknown extensions", () => {
    expect(classForFilename("PART.STL")).toBe("pipeline");
    expect(classForFilename("readme.pdf")).toBeNull();
    expect(classForFilename("noext")).toBeNull();
  });
});

describe("classForFormat", () => {
  it("mirrors the server's normalized source_format", () => {
    expect(classForFormat("stl")).toBe("pipeline");
    expect(classForFormat("gerber")).toBe("as_is");
    expect(classForFormat("unknown_format")).toBeNull();
  });
});

describe("isAcceptedExtension", () => {
  it("accepts the full multiformat list", () => {
    expect(isAcceptedExtension("model.stl")).toBe(true);
    expect(isAcceptedExtension("case.step")).toBe(true);
    expect(isAcceptedExtension("code.zip")).toBe(true);
  });

  it("rejects formats outside the policy", () => {
    expect(isAcceptedExtension("photo.jpg")).toBe(false);
    expect(isAcceptedExtension("doc.pdf")).toBe(false);
  });
});
