import { describe, expect, it } from "vitest";
import { ManifestDiagnosticError, MANIFEST_ERROR_CODE } from "./diagnostics.ts";
import { MAX_MANIFEST_BYTES } from "./limits.ts";
import { safeParseManifestYaml } from "./yamlSafe.ts";

describe("safeParseManifestYaml — security suite", () => {
  it("parses a legitimate small manifest", () => {
    const { value } = safeParseManifestYaml("schemaVersion: 1\nproject:\n  name: Test\n");
    expect(value).toEqual({ schemaVersion: 1, project: { name: "Test" } });
  });

  it("rejects a YAML anchor/alias bomb (billion laughs)", () => {
    let src = "a0: &a0 [x]\n";
    for (let i = 1; i <= 20; i++) src += `a${i}: &a${i} [*a${i - 1}, *a${i - 1}]\n`;
    expect(() => safeParseManifestYaml(src)).toThrowError(expect.objectContaining({ code: MANIFEST_ERROR_CODE.MANIFEST_YAML_UNSAFE }));
  });

  it("rejects duplicate keys in the same mapping", () => {
    expect(() => safeParseManifestYaml("schemaVersion: 1\nschemaVersion: 2\n")).toThrowError(expect.objectContaining({ code: MANIFEST_ERROR_CODE.MANIFEST_YAML_UNSAFE }));
  });

  it("rejects malformed YAML syntax", () => {
    expect(() => safeParseManifestYaml("schemaVersion: [1\n")).toThrowError(expect.objectContaining({ code: MANIFEST_ERROR_CODE.MANIFEST_YAML_UNSAFE }));
  });

  it("rejects a document whose top level is a scalar", () => {
    expect(() => safeParseManifestYaml("just a string\n")).toThrowError(expect.objectContaining({ code: MANIFEST_ERROR_CODE.MANIFEST_NOT_AN_OBJECT }));
  });

  it("rejects a document whose top level is a list", () => {
    expect(() => safeParseManifestYaml("- a\n- b\n")).toThrowError(expect.objectContaining({ code: MANIFEST_ERROR_CODE.MANIFEST_NOT_AN_OBJECT }));
  });

  it("rejects a manifest over the byte size limit", () => {
    const huge = "schemaVersion: 1\nproject:\n  name: " + "x".repeat(MAX_MANIFEST_BYTES + 1) + "\n";
    expect(() => safeParseManifestYaml(huge)).toThrowError(expect.objectContaining({ code: MANIFEST_ERROR_CODE.MANIFEST_TOO_LARGE }));
  });

  it("rejects excessive nesting depth", () => {
    let src = "root: &r []\n";
    // deep chain of one-element arrays, no aliases involved — exercises the post-parse depth
    // guard independently from the parser's own alias-count protection.
    let inner = "0";
    for (let i = 0; i < 40; i++) inner = `[${inner}]`;
    src = `schemaVersion: 1\nproject:\n  name: x\nx-deep: ${inner}\n`;
    expect(() => safeParseManifestYaml(src)).toThrowError(expect.objectContaining({ code: MANIFEST_ERROR_CODE.MANIFEST_TOO_LARGE }));
  });

  it("throws a ManifestDiagnosticError instance (not a bare Error) on rejection", () => {
    expect(() => safeParseManifestYaml("[1\n")).toThrow(ManifestDiagnosticError);
  });
});
