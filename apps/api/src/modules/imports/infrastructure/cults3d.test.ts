import { describe, expect, it, vi } from "vitest";
import { encryptIdentity } from "../../auth/infrastructure/auth-crypto.ts";
import { pool } from "../../../db/client.ts";
import { PermanentImportItemError } from "../domain/import-errors.ts";
import { createCults3dConnector, SlidingWindowLimiter } from "./cults3d.ts";

interface Call {
  url: string;
  init: RequestInit;
  query: string;
}

// Роутер GraphQL-запросов по имени операции (`query OwnPortfolio(...)`, `query CreationMeta(...)`,
// …) — тот же приём, что fixtureClient в printers/prusaConnect.sync.test.ts, только на уровне
// сырого fetch, потому что коннектор сам строит запрос (интерфейс ImportConnector этого не
// абстрагирует). Каждый responder получает распарсенные variables и решает, что вернуть.
function fixtureFetch(responders: Record<string, (variables: Record<string, unknown>, calls: Call[]) => unknown>) {
  const calls: Call[] = [];
  const fetchImpl = vi.fn(async (url: string | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as { query: string; variables: Record<string, unknown> };
    const call: Call = { url: String(url), init: init ?? {}, query: body.query };
    calls.push(call);

    const opMatch = body.query.match(/query\s+(\w+)/);
    const opName = opMatch?.[1] ?? "";
    const responder = responders[opName];
    if (!responder) throw new Error(`no fixture responder for operation ${opName}`);

    const result = responder(body.variables, calls);
    if (result instanceof Response) return result;
    return new Response(JSON.stringify(result), { status: 200, headers: { "content-type": "application/json" } });
  });
  return { fetchImpl: fetchImpl as unknown as typeof fetch, calls };
}

const noOpLimiter = new SlidingWindowLimiter(1_000_000, 30_000);

describe("createCults3dConnector", () => {
  it("sends Basic auth and an honest, attributed User-Agent", async () => {
    const { fetchImpl, calls } = fixtureFetch({
      OwnPortfolio: () => ({ data: { myself: { creations: [], printlists: [] } } }),
    });
    const connector = createCults3dConnector({ username: "alice", apiKey: "s3cr3t" }, null, { fetchImpl, limiter: noOpLimiter });

    await connector.listOwnModels({ username: "alice", apiKey: "s3cr3t" });

    expect(calls).toHaveLength(1);
    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers.authorization).toBe(`Basic ${Buffer.from("alice:s3cr3t").toString("base64")}`);
    expect(headers["user-agent"]).toMatch(/3mf\.tech/);
    expect(headers["user-agent"]).toMatch(/support@3mf\.tech|https:\/\/3mf\.tech/);
  });

  it("listOwnModels merges creations and printlists, deduped by id, own creations win", async () => {
    const { fetchImpl } = fixtureFetch({
      OwnPortfolio: () => ({
        data: {
          myself: {
            creations: [{ id: "1", name: "Widget", shortUrl: "https://cults3d.com/en/3d-model/widget", illustrationImageUrl: "https://img/1.jpg" }],
            printlists: [
              { creation: { id: "1", name: "Widget (stale copy)", shortUrl: "https://cults3d.com/en/3d-model/widget" } },
              { creation: { id: "2", name: "Gadget", shortUrl: "https://cults3d.com/en/3d-model/gadget" } },
            ],
          },
        },
      }),
    });
    const connector = createCults3dConnector({ username: "alice", apiKey: "k" }, null, { fetchImpl, limiter: noOpLimiter });

    const models = await connector.listOwnModels({ username: "alice", apiKey: "k" });

    expect(models).toEqual([
      { externalId: "1", title: "Widget", originalUrl: "https://cults3d.com/en/3d-model/widget", thumbnailUrl: "https://img/1.jpg" },
      { externalId: "2", title: "Gadget", originalUrl: "https://cults3d.com/en/3d-model/gadget" },
    ]);
  });

  it("listOwnModels drops entries missing required fields instead of crashing", async () => {
    const { fetchImpl } = fixtureFetch({
      OwnPortfolio: () => ({
        data: { myself: { creations: [{ id: "1" }, { name: "no id", shortUrl: "https://x" }], printlists: [] } },
      }),
    });
    const connector = createCults3dConnector({ username: "a", apiKey: "k" }, null, { fetchImpl, limiter: noOpLimiter });

    const models = await connector.listOwnModels({ username: "a", apiKey: "k" });
    expect(models).toEqual([]);
  });

  it("resolveMeta maps a Cults3D creation into ExternalModelMeta, aliasing counters to nbLikes/nbDownloads/nbViews", async () => {
    const { fetchImpl } = fixtureFetch({
      CreationMeta: (vars) => ({
        data: {
          creation: {
            id: vars.id,
            name: "Example Widget",
            shortUrl: "https://cults3d.com/en/3d-model/gadget/example-widget",
            description: "A widget for testing.",
            license: "Creative Commons - Attribution - Non Commercial",
            tagNames: ["Gadget", "widget"],
            category: { name: "Gadgets" },
            nbLikes: 42,
            nbDownloads: 108,
            nbViews: 999,
          },
        },
      }),
    });
    const connector = createCults3dConnector({ username: "a", apiKey: "k" }, null, { fetchImpl, limiter: noOpLimiter });

    const meta = await connector.resolveMeta("123456");

    expect(meta.raw).toBeDefined();
    const { raw, ...rest } = meta;
    void raw;
    expect(rest).toEqual({
      externalId: "123456",
      originalUrl: "https://cults3d.com/en/3d-model/gadget/example-widget",
      title: "Example Widget",
      description: "A widget for testing.",
      license: "Creative Commons - Attribution - Non Commercial",
      tags: ["Gadget", "widget"],
      category: "Gadgets",
      popularity: { nbLikes: 42, nbDownloads: 108, nbViews: 999 },
    });
  });

  it("resolveMeta throws PermanentImportItemError when the source has no such creation", async () => {
    const { fetchImpl } = fixtureFetch({ CreationMeta: () => ({ data: { creation: null } }) });
    const connector = createCults3dConnector({ username: "a", apiKey: "k" }, null, { fetchImpl, limiter: noOpLimiter });

    await expect(connector.resolveMeta("gone")).rejects.toBeInstanceOf(PermanentImportItemError);
  });

  it("fetchFiles uses the creation's own blueprints when present", async () => {
    const { fetchImpl } = fixtureFetch({
      CreationBlueprints: () => ({
        data: { creation: { id: "1", blueprints: [{ fileUrl: "https://cults3d.com/files/widget.stl", filename: "widget.stl" }] } },
      }),
    });
    const connector = createCults3dConnector({ username: "a", apiKey: "k" }, null, { fetchImpl, limiter: noOpLimiter });

    const files = await connector.fetchFiles("1");
    expect(files).toEqual([{ filename: "widget.stl", downloadUrl: "https://cults3d.com/files/widget.stl" }]);
  });

  it("fetchFiles falls back to myself.orders[].downloadUrl for a purchased (not own) model", async () => {
    const { fetchImpl } = fixtureFetch({
      CreationBlueprints: () => ({ data: { creation: { id: "7", blueprints: [] } } }),
      MyOrders: () => ({
        data: {
          myself: {
            orders: [
              { creation: { id: "1" }, downloadUrl: "https://cults3d.com/files/other.stl" },
              { creation: { id: "7" }, downloadUrl: "https://cults3d.com/files/purchased.stl", filename: "purchased.stl" },
            ],
          },
        },
      }),
    });
    const connector = createCults3dConnector({ username: "a", apiKey: "k" }, null, { fetchImpl, limiter: noOpLimiter });

    const files = await connector.fetchFiles("7");
    expect(files).toEqual([{ filename: "purchased.stl", downloadUrl: "https://cults3d.com/files/purchased.stl" }]);
  });

  it("fetchFiles returns empty when neither blueprints nor a matching order exist", async () => {
    const { fetchImpl } = fixtureFetch({
      CreationBlueprints: () => ({ data: { creation: { id: "9", blueprints: [] } } }),
      MyOrders: () => ({ data: { myself: { orders: [] } } }),
    });
    const connector = createCults3dConnector({ username: "a", apiKey: "k" }, null, { fetchImpl, limiter: noOpLimiter });

    expect(await connector.fetchFiles("9")).toEqual([]);
  });

  it("fetchImages returns the illustration first, deduped against imageUrls", async () => {
    const { fetchImpl } = fixtureFetch({
      CreationImages: () => ({
        data: {
          creation: {
            id: "1",
            illustrationImageUrl: "https://img/main.jpg",
            imageUrls: ["https://img/main.jpg", "https://img/side.jpg"],
          },
        },
      }),
    });
    const connector = createCults3dConnector({ username: "a", apiKey: "k" }, null, { fetchImpl, limiter: noOpLimiter });

    const images = await connector.fetchImages("1");
    expect(images).toEqual([{ url: "https://img/main.jpg", isPrimary: true }, { url: "https://img/side.jpg" }]);
  });

  it("429 is a transient Error (not Permanent) — worker's normal backoff handles the retry", async () => {
    const fetchImpl = vi.fn(async () => new Response("rate limited", { status: 429 })) as unknown as typeof fetch;
    const connector = createCults3dConnector({ username: "a", apiKey: "k" }, null, { fetchImpl, limiter: noOpLimiter });

    const err = await connector.resolveMeta("1").catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(PermanentImportItemError);
  });

  it("5xx is also transient", async () => {
    const fetchImpl = vi.fn(async () => new Response("oops", { status: 503 })) as unknown as typeof fetch;
    const connector = createCults3dConnector({ username: "a", apiKey: "k" }, null, { fetchImpl, limiter: noOpLimiter });

    const err = await connector.resolveMeta("1").catch((e) => e);
    expect(err).not.toBeInstanceOf(PermanentImportItemError);
  });

  it("401/403 is a PermanentImportItemError — a bad key will never succeed on retry", async () => {
    const fetchImpl = vi.fn(async () => new Response("nope", { status: 401 })) as unknown as typeof fetch;
    const connector = createCults3dConnector({ username: "a", apiKey: "bad" }, null, { fetchImpl, limiter: noOpLimiter });

    await expect(connector.listOwnModels({ username: "a", apiKey: "bad" })).rejects.toBeInstanceOf(PermanentImportItemError);
  });

  it("a GraphQL error saying 'not found' is permanent; any other GraphQL error is transient", async () => {
    const notFound = vi.fn(async () => new Response(JSON.stringify({ errors: [{ message: "Creation not found" }] }), { status: 200 }));
    const other = vi.fn(async () => new Response(JSON.stringify({ errors: [{ message: "Internal server hiccup" }] }), { status: 200 }));

    const c1 = createCults3dConnector({ username: "a", apiKey: "k" }, null, { fetchImpl: notFound as unknown as typeof fetch, limiter: noOpLimiter });
    await expect(c1.resolveMeta("1")).rejects.toBeInstanceOf(PermanentImportItemError);

    const c2 = createCults3dConnector({ username: "a", apiKey: "k" }, null, { fetchImpl: other as unknown as typeof fetch, limiter: noOpLimiter });
    const err = await c2.resolveMeta("1").catch((e) => e);
    expect(err).not.toBeInstanceOf(PermanentImportItemError);
    expect(err).toBeInstanceOf(Error);
  });

  it("marks the import connection ownership as verified after the first successful request, only once", async () => {
    const { fetchImpl } = fixtureFetch({
      OwnPortfolio: () => ({ data: { myself: { creations: [], printlists: [] } } }),
    });
    const userResult = await pool.query<{ id: string }>(`insert into users (username) values ($1) returning id`, [
      `cults3d-connector-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    ]);
    const userId = userResult.rows[0]!.id;
    try {
      const encrypted = encryptIdentity({ api_key: "k" });
      const connResult = await pool.query<{ id: string }>(
        `insert into import_connections (user_id, source_platform, credential_enc, ownership_status)
         values ($1, 'cults3d', $2, 'unverified') returning id`,
        [userId, encrypted],
      );
      const connectionId = connResult.rows[0]!.id;

      const connector = createCults3dConnector({ username: "a", apiKey: "k" }, connectionId, { fetchImpl, limiter: noOpLimiter });
      await connector.listOwnModels({ username: "a", apiKey: "k" });
      await connector.listOwnModels({ username: "a", apiKey: "k" });

      const row = await pool.query<{ ownership_status: string }>(`select ownership_status from import_connections where id = $1`, [connectionId]);
      expect(row.rows[0]!.ownership_status).toBe("verified");
    } finally {
      await pool.query(`delete from users where id = $1`, [userId]);
    }
  });
});

describe("SlidingWindowLimiter", () => {
  it("lets requests through under the cap without waiting", async () => {
    let now = 0;
    const wait = vi.fn(async (ms: number) => {
      now += ms;
    });
    const limiter = new SlidingWindowLimiter(3, 1000, () => now, wait);

    await limiter.acquire();
    await limiter.acquire();
    await limiter.acquire();

    expect(wait).not.toHaveBeenCalled();
  });

  it("waits out the window once the cap is hit, then proceeds", async () => {
    let now = 0;
    const wait = vi.fn(async (ms: number) => {
      now += ms;
    });
    const limiter = new SlidingWindowLimiter(2, 1000, () => now, wait);

    await limiter.acquire(); // t=0
    await limiter.acquire(); // t=0
    await limiter.acquire(); // over the cap — must wait until t>=1000

    expect(wait).toHaveBeenCalled();
    expect(now).toBeGreaterThanOrEqual(1000);
  });
});
