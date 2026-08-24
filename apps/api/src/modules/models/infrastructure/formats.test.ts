import zlib from "node:zlib";
import { describe, expect, it } from "vitest";
import {
  checkZipContainerSafety,
  craftForRole,
  DecompressionLimitError,
  detectAndValidateFormat,
  detectDxfAscii,
  detectDxfBinary,
  detectGcode,
  detectGerber,
  detectObj,
  detectStep,
  detectStl,
  detectSvg,
  FormatMismatchError,
  formatFromFilename,
  has3mfManifest,
  resolveZipRole,
  UnsupportedFormatError,
  validateFormatSignature,
} from "./formats.ts";

// Спайк-эталон детекторов — те же сэмплы, что `apps/mesh/tests/test_format_spike.py`
// (карточка MF-500): не выдумка, типичный вывод реальных генераторов каждого формата.

const STEP_SAMPLE = Buffer.from("ISO-10303-21;\nHEADER;\nFILE_DESCRIPTION((''),'2;1');\nENDSEC;\nDATA;\nENDSEC;\nEND-ISO-10303-21;\n");

const DXF_ASCII_SAMPLE =
  "0\nSECTION\n2\nHEADER\n9\n$ACADVER\n1\nAC1027\n0\nENDSEC\n" + "0\nSECTION\n2\nENTITIES\n0\nLINE\n8\n0\n10\n0.0\n20\n0.0\n11\n10.0\n21\n0.0\n" + "0\nENDSEC\n0\nEOF\n";

const SVG_SAMPLE = '<?xml version="1.0" encoding="UTF-8"?>\n' + '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100">' + '<rect width="100" height="100"/></svg>\n';

const GCODE_PRINTER_SAMPLE = ";FLAVOR:Marlin\n;TIME:1234\n;Layer height: 0.2\n" + "G21\nG90\nM82\nG28\nG1 Z5 F5000\nG1 X10 Y10 F3000\nG1 X20 Y10 E5 F1200\n" + "M107\nM104 S0\n";

const GCODE_FANUC_PERCENT_SAMPLE = "%\nO0001\nG90 G94 G17 G21 G49 G40 G80\nG54 G0 X0 Y0\nM3 S3000\n" + "G43 Z25. H1\nG1 Z-1. F150.\nG1 X10.\nG1 Y10.\nM5\nG91 G28 Z0\nM30\n%\n";

const GERBER_SAMPLE = "%FSLAX26Y26*%\n%MOMM*%\n%ADD10C,0.500000*%\n" + "G04 Layer_1*\nD10*\nX0Y0D02*\nX1000000Y0D01*\nX1000000Y1000000D01*\nM02*\n";

describe("formatFromFilename", () => {
  it("maps known extensions to formats", () => {
    expect(formatFromFilename("part.STL")).toBe("stl");
    expect(formatFromFilename("part.stp")).toBe("step");
    expect(formatFromFilename("part.step")).toBe("step");
    expect(formatFromFilename("layout.gbr")).toBe("gerber");
    expect(formatFromFilename("firmware.zip")).toBe("zip");
  });

  it("returns null for unknown extensions", () => {
    expect(formatFromFilename("photo.png")).toBeNull();
    expect(formatFromFilename(undefined)).toBeNull();
  });
});

describe("resolveZipRole", () => {
  it("defaults to code_archive without a hint", () => {
    expect(resolveZipRole(undefined)).toBe("code_archive");
    expect(resolveZipRole(null)).toBe("code_archive");
  });

  it("honors an explicit gerber hint", () => {
    expect(resolveZipRole("gerber")).toBe("gerber");
  });
});

describe("craftForRole", () => {
  it("maps unambiguous roles to their craft", () => {
    expect(craftForRole("cnc_program")).toBe("cnc");
    expect(craftForRole("gerber")).toBe("electronics");
    expect(craftForRole("code_archive")).toBe("software");
  });

  it("defaults ambiguous/printing roles to 3d_printing", () => {
    expect(craftForRole("source")).toBe("3d_printing");
    expect(craftForRole("aux")).toBe("3d_printing");
    expect(craftForRole("drawing")).toBe("3d_printing");
  });
});

describe("true positives (MF-500 spike samples)", () => {
  it("detects STEP", () => expect(detectStep(STEP_SAMPLE)).toBe(true));
  it("detects DXF ASCII", () => expect(detectDxfAscii(DXF_ASCII_SAMPLE)).toBe(true));
  it("detects DXF binary", () => expect(detectDxfBinary(Buffer.from("AutoCAD Binary DXF\r\n\x1a\x00\x00\x00rest", "latin1"))).toBe(true));
  it("detects SVG", () => expect(detectSvg(SVG_SAMPLE)).toBe(true));
  it("detects SVG with doctype/comment preamble", () => {
    const text =
      '<?xml version="1.0"?>\n' +
      '<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">\n' +
      "<!-- Generator: Inkscape -->\n" +
      '<svg xmlns="http://www.w3.org/2000/svg"></svg>\n';
    expect(detectSvg(text)).toBe(true);
  });
  it("detects G-code (Marlin printer style)", () => expect(detectGcode(GCODE_PRINTER_SAMPLE)).toBe(true));
  it("detects G-code (Fanuc percent-delimited style)", () => expect(detectGcode(GCODE_FANUC_PERCENT_SAMPLE)).toBe(true));
  it("detects Gerber", () => expect(detectGerber(GERBER_SAMPLE)).toBe(true));
  it("detects OBJ", () => expect(detectObj("v 0 0 0\nv 1 0 0\nf 1 2 3\n")).toBe(true));

  it("detects ASCII STL", () => {
    const ascii = Buffer.from("solid test\nfacet normal 0 0 1\nendfacet\nendsolid test\n", "ascii");
    expect(detectStl(ascii)).toBe(true);
  });

  it("detects binary STL by exact size formula", () => {
    const header = Buffer.alloc(80);
    const countBuf = Buffer.alloc(4);
    countBuf.writeUInt32LE(1, 0);
    const triangle = Buffer.alloc(50);
    expect(detectStl(Buffer.concat([header, countBuf, triangle]))).toBe(true);
  });
});

describe("cross-format false positives (MF-500 п.5)", () => {
  it("gcode detector does not trigger on svg/gerber/dxf", () => {
    expect(detectGcode(SVG_SAMPLE)).toBe(false);
    expect(detectGcode(GERBER_SAMPLE)).toBe(false);
    expect(detectGcode(DXF_ASCII_SAMPLE)).toBe(false);
  });

  it("gerber detector does not trigger on svg/dxf/gcode-printer", () => {
    expect(detectGerber(SVG_SAMPLE)).toBe(false);
    expect(detectGerber(DXF_ASCII_SAMPLE)).toBe(false);
    expect(detectGerber(GCODE_PRINTER_SAMPLE)).toBe(false);
  });

  it("gerber detector does not trigger on Fanuc percent-delimited gcode", () => {
    // Ключевой кейс: голые `%`-разделители похожи на Gerber-обрамление, но Gerber требует
    // реальную расширенную команду.
    expect(detectGerber(GCODE_FANUC_PERCENT_SAMPLE)).toBe(false);
  });

  it("dxf detector does not trigger on gerber/gcode/fanuc-gcode", () => {
    expect(detectDxfAscii(GERBER_SAMPLE)).toBe(false);
    expect(detectDxfAscii(GCODE_PRINTER_SAMPLE)).toBe(false);
    expect(detectDxfAscii(GCODE_FANUC_PERCENT_SAMPLE)).toBe(false);
  });

  it("svg detector does not trigger on gerber/gcode/dxf", () => {
    expect(detectSvg(GERBER_SAMPLE)).toBe(false);
    expect(detectSvg(GCODE_PRINTER_SAMPLE)).toBe(false);
    expect(detectSvg(DXF_ASCII_SAMPLE)).toBe(false);
  });

  it("step detector does not collide with other text formats", () => {
    for (const sample of [SVG_SAMPLE, GERBER_SAMPLE, DXF_ASCII_SAMPLE, GCODE_PRINTER_SAMPLE]) {
      expect(detectStep(Buffer.from(sample, "utf8"))).toBe(false);
    }
  });

  it("rejects an SVG disguised with a .gcode extension (spoof attack)", () => {
    expect(detectGcode(SVG_SAMPLE)).toBe(false);
  });
});

// --- ZIP central directory + safety --------------------------------------------------------

interface ZipEntrySpec {
  name: string;
  content: Buffer;
  externalAttr?: number;
}

function buildZip(entries: ZipEntrySpec[]): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0, 6);
    localHeader.writeUInt16LE(0, 8); // stored, без сжатия
    localHeader.writeUInt16LE(0, 10);
    localHeader.writeUInt16LE(0, 12);
    localHeader.writeUInt32LE(0, 14);
    localHeader.writeUInt32LE(entry.content.length, 18);
    localHeader.writeUInt32LE(entry.content.length, 22);
    localHeader.writeUInt16LE(name.length, 26);
    localHeader.writeUInt16LE(0, 28);

    const localEntry = Buffer.concat([localHeader, name, entry.content]);
    localParts.push(localEntry);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0, 8);
    centralHeader.writeUInt16LE(0, 10);
    centralHeader.writeUInt16LE(0, 12);
    centralHeader.writeUInt16LE(0, 14);
    centralHeader.writeUInt32LE(0, 16);
    centralHeader.writeUInt32LE(entry.content.length, 20);
    centralHeader.writeUInt32LE(entry.content.length, 24);
    centralHeader.writeUInt16LE(name.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(entry.externalAttr ?? 0, 38);
    centralHeader.writeUInt32LE(offset, 42);

    centralParts.push(Buffer.concat([centralHeader, name]));
    offset += localEntry.length;
  }

  const localSection = Buffer.concat(localParts);
  const centralSection = Buffer.concat(centralParts);

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralSection.length, 12);
  eocd.writeUInt32LE(localSection.length, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([localSection, centralSection, eocd]);
}

function buildDeflatedZip(name: string, payload: Buffer): Buffer {
  const compressed = zlib.deflateRawSync(payload);
  const nameBuf = Buffer.from(name, "utf8");

  const localHeader = Buffer.alloc(30);
  localHeader.writeUInt32LE(0x04034b50, 0);
  localHeader.writeUInt16LE(20, 4);
  localHeader.writeUInt16LE(0, 6);
  localHeader.writeUInt16LE(8, 8); // deflate
  localHeader.writeUInt16LE(0, 10);
  localHeader.writeUInt16LE(0, 12);
  localHeader.writeUInt32LE(0, 14);
  localHeader.writeUInt32LE(compressed.length, 18);
  localHeader.writeUInt32LE(payload.length, 22);
  localHeader.writeUInt16LE(nameBuf.length, 26);
  localHeader.writeUInt16LE(0, 28);

  const localEntry = Buffer.concat([localHeader, nameBuf, compressed]);

  const centralHeader = Buffer.alloc(46);
  centralHeader.writeUInt32LE(0x02014b50, 0);
  centralHeader.writeUInt16LE(20, 4);
  centralHeader.writeUInt16LE(20, 6);
  centralHeader.writeUInt16LE(0, 8);
  centralHeader.writeUInt16LE(8, 10);
  centralHeader.writeUInt16LE(0, 12);
  centralHeader.writeUInt16LE(0, 14);
  centralHeader.writeUInt32LE(0, 16);
  centralHeader.writeUInt32LE(compressed.length, 20);
  centralHeader.writeUInt32LE(payload.length, 24);
  centralHeader.writeUInt16LE(nameBuf.length, 28);
  centralHeader.writeUInt16LE(0, 30);
  centralHeader.writeUInt16LE(0, 32);
  centralHeader.writeUInt16LE(0, 34);
  centralHeader.writeUInt16LE(0, 36);
  centralHeader.writeUInt32LE(0, 38);
  centralHeader.writeUInt32LE(0, 42);

  const centralEntry = Buffer.concat([centralHeader, nameBuf]);

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(centralEntry.length, 12);
  eocd.writeUInt32LE(localEntry.length, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([localEntry, centralEntry, eocd]);
}

describe("checkZipContainerSafety", () => {
  it("passes a normal archive", () => {
    const zip = buildZip([
      { name: "firmware/main.c", content: Buffer.from("int main(void) { return 0; }\n") },
      { name: "firmware/readme.txt", content: Buffer.from("build with make\n") },
    ]);
    expect(checkZipContainerSafety(zip)).toBeNull();
  });

  it("rejects a path traversal entry", () => {
    const zip = buildZip([{ name: "../../etc/passwd", content: Buffer.from("root:x:0:0\n") }]);
    expect(checkZipContainerSafety(zip)?.reason).toBe("path_traversal");
  });

  it("rejects an absolute path entry", () => {
    const zip = buildZip([{ name: "/etc/passwd", content: Buffer.from("root:x:0:0\n") }]);
    expect(checkZipContainerSafety(zip)?.reason).toBe("path_traversal");
  });

  it("rejects a symlink entry", () => {
    const S_IFLNK = 0xa000;
    // `<<` в JS работает над знаковым int32 — приводим к unsigned, иначе Buffer.writeUInt32LE
    // падает на "out of range" для режимов со старшим битом (симлинк) как в реальном external_attr.
    const zip = buildZip([{ name: "link", content: Buffer.from("/etc/passwd"), externalAttr: ((S_IFLNK | 0o777) << 16) >>> 0 }]);
    expect(checkZipContainerSafety(zip)?.reason).toBe("symlink_entry");
  });

  it("rejects a decompression-bomb ratio", () => {
    const zip = buildDeflatedZip("payload.bin", Buffer.alloc(10 * 1024 * 1024, 0));
    expect(checkZipContainerSafety(zip, { maxRatio: 100 })?.reason).toBe("compression_ratio");
  });

  it("rejects too many entries", () => {
    const zip = buildZip(Array.from({ length: 50 }, (_, i) => ({ name: `f${i}.txt`, content: Buffer.from("x") })));
    expect(checkZipContainerSafety(zip, { maxEntries: 10 })?.reason).toBe("too_many_entries");
  });
});

describe("has3mfManifest", () => {
  it("accepts a zip with the required 3MF manifest entries", () => {
    const zip = buildZip([
      { name: "[Content_Types].xml", content: Buffer.from("<Types/>") },
      { name: "3D/3dmodel.model", content: Buffer.from("<model/>") },
    ]);
    expect(has3mfManifest(zip)).toBe(true);
  });

  it("rejects a plain zip masquerading as 3MF", () => {
    const zip = buildZip([{ name: "readme.txt", content: Buffer.from("hi") }]);
    expect(has3mfManifest(zip)).toBe(false);
  });
});

describe("validateFormatSignature / detectAndValidateFormat — end to end", () => {
  it("accepts a valid STEP upload as an as-is artifact with role aux", () => {
    const result = validateFormatSignature("step", STEP_SAMPLE);
    expect(result).toEqual({ format: "step", formatClass: "as_is", role: "aux" });
  });

  it("throws FormatMismatchError for a .step file with unrelated content", () => {
    expect(() => validateFormatSignature("step", Buffer.from("hello"))).toThrow(FormatMismatchError);
  });

  it("throws UnsupportedFormatError for an unknown extension", () => {
    expect(() => detectAndValidateFormat("photo.png", Buffer.from("x"))).toThrow(UnsupportedFormatError);
  });

  it("assigns pipeline class + source role to a valid STL", () => {
    const ascii = Buffer.from("solid t\nfacet normal 0 0 1\nendfacet\nendsolid t\n", "ascii");
    expect(detectAndValidateFormat("part.stl", ascii)).toEqual({ format: "stl", formatClass: "pipeline", role: "source" });
  });

  it("assigns as_is class + cnc_program role to a valid gcode file", () => {
    expect(detectAndValidateFormat("job.gcode", Buffer.from(GCODE_PRINTER_SAMPLE))).toEqual({
      format: "gcode",
      formatClass: "as_is",
      role: "cnc_program",
    });
  });

  it("resolves zip role from the hint (gerber set vs code archive)", () => {
    const zip = buildZip([{ name: "layer1.gbr", content: Buffer.from("x") }]);
    expect(detectAndValidateFormat("board.zip", zip, "gerber").role).toBe("gerber");
    expect(detectAndValidateFormat("board.zip", zip).role).toBe("code_archive");
  });

  it("throws DecompressionLimitError for a zip-bomb", () => {
    const zip = buildDeflatedZip("payload.bin", Buffer.alloc(10 * 1024 * 1024, 0));
    expect(() => detectAndValidateFormat("archive.zip", zip)).toThrow(DecompressionLimitError);
  });

  it("throws FormatMismatchError for a 3mf file without the required manifest", () => {
    const zip = buildZip([{ name: "readme.txt", content: Buffer.from("hi") }]);
    expect(() => detectAndValidateFormat("model.3mf", zip)).toThrow(FormatMismatchError);
  });

  it("accepts a valid 3mf manifest", () => {
    const zip = buildZip([
      { name: "[Content_Types].xml", content: Buffer.from("<Types/>") },
      { name: "3D/3dmodel.model", content: Buffer.from("<model/>") },
    ]);
    expect(detectAndValidateFormat("model.3mf", zip)).toEqual({ format: "3mf", formatClass: "pipeline", role: "source" });
  });
});
