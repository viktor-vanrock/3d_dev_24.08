import { describe, expect, it } from "vitest";
import { ALLOWED_MIME, FILE_ROLE, tempObjectKey, UPLOAD_LIMITS, UploadErrors } from "./upload.ts";

describe("UPLOAD_LIMITS", () => {
  it("covers all FILE_ROLE values", () => {
    expect(Object.values(FILE_ROLE).filter((role) => !(role in UPLOAD_LIMITS))).toEqual([]);
  });

  it("limits source to 100 MiB", () => {
    expect(UPLOAD_LIMITS.source).toBe(100 * 1024 * 1024);
  });
});

describe("ALLOWED_MIME", () => {
  it("covers all FILE_ROLE values", () => {
    expect(Object.values(FILE_ROLE).filter((role) => !(role in ALLOWED_MIME))).toEqual([]);
  });

  it("allows model/stl as source but not as avatar", () => {
    expect(ALLOWED_MIME.source.has("model/stl")).toBe(true);
    expect(ALLOWED_MIME.avatar.has("model/stl")).toBe(false);
  });
});

describe("UploadErrors", () => {
  it("keeps expected HTTP status codes", () => {
    expect(UploadErrors.tooLarge("source").statusCode).toBe(413);
    expect(UploadErrors.unsupportedMime("text/html").statusCode).toBe(415);
    expect(UploadErrors.uploadNotFound().statusCode).toBe(404);
  });
});

describe("tempObjectKey", () => {
  it("uses a distinct temporary prefix per id", () => {
    expect(tempObjectKey("abc")).toContain("temp/uploads/");
    expect(tempObjectKey("id1")).not.toBe(tempObjectKey("id2"));
  });
});
