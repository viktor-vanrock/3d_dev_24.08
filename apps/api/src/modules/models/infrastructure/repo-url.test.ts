import { describe, expect, it } from "vitest";
import { InvalidRepoUrlError, validateRepoUrl } from "./repo-url.ts";

describe("validateRepoUrl", () => {
  it("accepts a valid https URL", () => {
    expect(validateRepoUrl("https://gitverse.ru/plag/portal.ru")).toBe("https://gitverse.ru/plag/portal.ru");
  });

  it("rejects http (non-https) URLs", () => {
    expect(() => validateRepoUrl("http://gitverse.ru/plag/portal.ru")).toThrow(InvalidRepoUrlError);
  });

  it("rejects non-URL strings", () => {
    expect(() => validateRepoUrl("not-a-url")).toThrow(InvalidRepoUrlError);
  });

  it("rejects other protocols such as javascript:", () => {
    expect(() => validateRepoUrl("javascript:alert(1)")).toThrow(InvalidRepoUrlError);
  });
});
