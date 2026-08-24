import { afterEach, describe, expect, it, vi } from "vitest";
import { embedSearchQuery, SEARCH_QUERY_EMBEDDING_DIM, toPgVectorLiteral } from "./searchEmbedClient.ts";

function stubFetch(handler: (url: string, init?: RequestInit) => Response) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => handler(url, init)),
  );
}

describe("embedSearchQuery (HYPERPC слот 4 /embed client for hybrid search)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.HYPERPC_URL;
  });

  it("returns null when HYPERPC_URL is not configured (no network attempted)", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    expect(await embedSearchQuery("q")).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns the embedding on a valid 2048-dim response matching the active profile", async () => {
    process.env.HYPERPC_URL = "http://100.74.48.83:8189";
    const vector = Array.from({ length: 2048 }, (_, i) => i / 2048);
    stubFetch((url, init) => {
      expect(url).toBe("http://100.74.48.83:8189/embed");
      expect(init?.method).toBe("POST");
      expect(JSON.parse(init!.body as string)).toEqual({ inputs: ["лапа манипулятора"] });
      return new Response(JSON.stringify({ embeddings: [vector], dim: 2048 }), { status: 200 });
    });

    const result = await embedSearchQuery("лапа манипулятора");
    expect(result).toEqual(vector);
  });

  it("returns null when HYPERPC is unreachable (network error)", async () => {
    process.env.HYPERPC_URL = "http://100.74.48.83:8189";
    stubFetch(() => {
      throw new TypeError("fetch failed");
    });
    expect(await embedSearchQuery("q")).toBeNull();
  });

  it("returns null on a non-200 response", async () => {
    process.env.HYPERPC_URL = "http://100.74.48.83:8189";
    stubFetch(() => new Response(JSON.stringify({ detail: "unavailable" }), { status: 503 }));
    expect(await embedSearchQuery("q")).toBeNull();
  });

  it("returns null on a dim mismatch (never trusts a vector of the wrong shape)", async () => {
    process.env.HYPERPC_URL = "http://100.74.48.83:8189";
    stubFetch(() => new Response(JSON.stringify({ embeddings: [[0.1, 0.2]], dim: 2 }), { status: 200 }));
    expect(await embedSearchQuery("q")).toBeNull();
  });

  it("returns null when embedding length disagrees with the declared dim", async () => {
    process.env.HYPERPC_URL = "http://100.74.48.83:8189";
    const vector = Array.from({ length: 100 }, () => 0.1);
    stubFetch(() => new Response(JSON.stringify({ embeddings: [vector], dim: 2048 }), { status: 200 }));
    expect(await embedSearchQuery("q")).toBeNull();
  });

  it("returns null on malformed JSON", async () => {
    process.env.HYPERPC_URL = "http://100.74.48.83:8189";
    stubFetch(() => new Response("not json", { status: 200 }));
    expect(await embedSearchQuery("q")).toBeNull();
  });

  it("respects HYPERPC_URL override", async () => {
    process.env.HYPERPC_URL = "http://hyperpc.internal:9999";
    const vector = Array.from({ length: SEARCH_QUERY_EMBEDDING_DIM }, () => 0);
    stubFetch((url) => {
      expect(url).toBe("http://hyperpc.internal:9999/embed");
      return new Response(JSON.stringify({ embeddings: [vector], dim: SEARCH_QUERY_EMBEDDING_DIM }), { status: 200 });
    });
    expect(await embedSearchQuery("q")).toEqual(vector);
  });
});

describe("toPgVectorLiteral", () => {
  it("formats a plain bracketed comma list without spaces", () => {
    expect(toPgVectorLiteral([1, 0.5, -2])).toBe("[1,0.5,-2]");
  });

  it("round-trips a full 2048-dim vector shape", () => {
    const vector = Array.from({ length: 2048 }, (_, i) => i * 0.001);
    const literal = toPgVectorLiteral(vector);
    expect(literal.startsWith("[")).toBe(true);
    expect(literal.endsWith("]")).toBe(true);
    expect(literal.split(",")).toHaveLength(2048);
  });
});
