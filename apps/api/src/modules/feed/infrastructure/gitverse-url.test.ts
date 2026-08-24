import { describe, expect, it } from "vitest";
import { InvalidGitverseUrlError, parseGitverseUrl } from "./gitverse-url.ts";

describe("parseGitverseUrl", () => {
  it("accepts a valid gitverse.ru repo URL and extracts owner/name", () => {
    const { normalized, repo } = parseGitverseUrl("https://gitverse.ru/plag/portal.ru");
    expect(normalized).toBe("https://gitverse.ru/plag/portal.ru");
    expect(repo).toEqual({ owner: "plag", name: "portal.ru" });
  });

  it("normalizes a trailing slash and drops extra path segments", () => {
    const { normalized, repo } = parseGitverseUrl("https://gitverse.ru/plag/portal.ru/tree/dev/apps");
    expect(normalized).toBe("https://gitverse.ru/plag/portal.ru");
    expect(repo).toEqual({ owner: "plag", name: "portal.ru" });
  });

  it("strips a .git suffix from the repo name", () => {
    const { normalized, repo } = parseGitverseUrl("https://gitverse.ru/plag/portal.ru.git");
    expect(normalized).toBe("https://gitverse.ru/plag/portal.ru");
    expect(repo).toEqual({ owner: "plag", name: "portal.ru" });
  });

  it("is case-insensitive on the host", () => {
    expect(parseGitverseUrl("https://GitVerse.ru/plag/portal.ru").normalized).toBe("https://gitverse.ru/plag/portal.ru");
  });

  it("rejects http (non-https) URLs", () => {
    expect(() => parseGitverseUrl("http://gitverse.ru/plag/portal.ru")).toThrow(InvalidGitverseUrlError);
  });

  it("rejects a different host — the allowlist is exactly one domain (SSRF gate)", () => {
    expect(() => parseGitverseUrl("https://github.com/plag/portal.ru")).toThrow(InvalidGitverseUrlError);
  });

  it("rejects a host that merely contains gitverse.ru as a suffix", () => {
    expect(() => parseGitverseUrl("https://evil-gitverse.ru/plag/portal.ru")).toThrow(InvalidGitverseUrlError);
  });

  it("rejects a URL missing the repo segment", () => {
    expect(() => parseGitverseUrl("https://gitverse.ru/plag")).toThrow(InvalidGitverseUrlError);
  });

  it("rejects non-URL strings", () => {
    expect(() => parseGitverseUrl("not-a-url")).toThrow(InvalidGitverseUrlError);
  });

  it("rejects other protocols such as javascript:", () => {
    expect(() => parseGitverseUrl("javascript:alert(1)")).toThrow(InvalidGitverseUrlError);
  });
});
