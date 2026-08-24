import { describe, expect, it, vi } from "vitest";
import { fetchGitverseRepoMeta } from "./gitverse-client.ts";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("fetchGitverseRepoMeta", () => {
  it("maps a Gitea-shaped repo response onto FeedGitverseRef", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        name: "portal.ru",
        description: "3mf.tech monorepo",
        stars_count: 7,
        language: "TypeScript",
        owner: { login: "plag", avatar_url: "https://gitverse.ru/avatars/plag.png" },
      }),
    );

    const repo = await fetchGitverseRepoMeta("https://gitverse.ru/plag/portal.ru", fetchMock);
    expect(repo).toEqual({
      owner: "plag",
      name: "portal.ru",
      avatar_url: "https://gitverse.ru/avatars/plag.png",
      description: "3mf.tech monorepo",
      stars: 7,
      language: "TypeScript",
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://gitverse.ru/api/v1/repos/plag/portal.ru",
      expect.objectContaining({ headers: expect.objectContaining({ "User-Agent": expect.any(String) }) }),
    );
  });

  it("fills in missing optional fields with defaults, not throw", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({}));
    const repo = await fetchGitverseRepoMeta("https://gitverse.ru/plag/portal.ru", fetchMock);
    expect(repo).toEqual({
      owner: "plag",
      name: "portal.ru",
      avatar_url: null,
      description: null,
      stars: 0,
      language: null,
    });
  });

  it("degrades to null on a non-2xx response (e.g. private repo/404), not throw", async () => {
    const fetchMock = vi.fn(async () => new Response("", { status: 404 }));
    expect(await fetchGitverseRepoMeta("https://gitverse.ru/plag/ghost", fetchMock)).toBeNull();
  });

  it("degrades to null on a network error/timeout, not throw", async () => {
    const fetchMock = vi.fn(async () => {
      throw new DOMException("The operation was aborted", "TimeoutError");
    });
    expect(await fetchGitverseRepoMeta("https://gitverse.ru/plag/portal.ru", fetchMock)).toBeNull();
  });

  it("degrades to null on malformed JSON, not throw", async () => {
    const fetchMock = vi.fn(async () => new Response("not json", { status: 200 }));
    expect(await fetchGitverseRepoMeta("https://gitverse.ru/plag/portal.ru", fetchMock)).toBeNull();
  });

  it("degrades to null for a URL off the gitverse.ru allowlist, without calling fetch (SSRF gate)", async () => {
    const fetchMock = vi.fn();
    expect(await fetchGitverseRepoMeta("https://attacker.example/internal", fetchMock)).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
