import { randomUUID } from "node:crypto";
import type { Request } from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pool } from "../../../db/client.ts";
import { UserId } from "../../_kernel/brandedIds.ts";
import type { GenerationResponse } from "../../generations/public/index.ts";
import type { AssistantExternalPort, AssistantGenerationsPort, AssistantPromptResult, AssistantThreadEvent } from "../public/index.ts";
import { AssistantRepository } from "../infrastructure/assistant.repository.ts";
import { AssistantService } from "./assistant.service.ts";

class FakeExternal implements AssistantExternalPort {
  promptResult: AssistantPromptResult = { ok: false, status: 503, error: "unavailable" };
  threadEvents: readonly AssistantThreadEvent[] = [];
  async assertPromptVariantsRateLimit(): Promise<void> {}
  isPromptBlocked(prompt: string): boolean {
    return /гранат/iu.test(prompt);
  }
  searchCatalogMatches() {
    return Promise.resolve([{ model_id: randomUUID(), title: "Catalog model", relevance_rank: 1 }]);
  }
  requestPromptVariants() {
    return Promise.resolve(this.promptResult);
  }
  loadThreadEventsAfter(_threadId: string, afterSeq: number) {
    return Promise.resolve(this.threadEvents.filter((event) => event.seq > afterSeq));
  }
}

class FakeGenerations implements AssistantGenerationsPort {
  generationId: string | null = null;
  createCalls = 0;
  async create(userId: ReturnType<typeof UserId>, body: Readonly<Record<string, unknown>>) {
    this.createCalls += 1;
    const row = (
      await pool.query<{ id: string }>("insert into generations (user_id, branch, prompt, params, assistant_offer_id) values ($1,$2,$3,$4,$5) returning id", [
        userId,
        body.branch,
        body.prompt,
        body.params ?? {},
        body.assistant_offer_id,
      ])
    ).rows[0];
    if (row === undefined) throw new Error("fake generation insert returned no row");
    this.generationId = row.id;
    return { status: 201, body: { generation: this.generation(row.id) } };
  }
  detail(_userId: ReturnType<typeof UserId>, generationId: string) {
    return Promise.resolve({ generation: this.generation(generationId) });
  }
  private generation(id: string): GenerationResponse {
    return {
      id,
      branch: "openscad",
      prompt: "test",
      params: {},
      status: "queued",
      preview_url: null,
      artifact_url: null,
      preview_shots: null,
      source_generation_id: null,
      source_angles: null,
      error: null,
      error_code: null,
      retryable: null,
      progress: null,
      delayed: null,
      queue_position: 1,
      created_at: new Date(),
      updated_at: new Date(),
    };
  }
}

async function createUser(label: string): Promise<string> {
  return (await pool.query<{ id: string }>("insert into users (username) values ($1) returning id", [`assistant-nest-${label}-${randomUUID()}`])).rows[0]!.id;
}

describe("AssistantService Nest migration", () => {
  const users: string[] = [];
  let service: AssistantService;
  let external: FakeExternal;
  let generations: FakeGenerations;

  beforeAll(() => {
    external = new FakeExternal();
    generations = new FakeGenerations();
    service = new AssistantService(new AssistantRepository(pool), external, generations);
  });
  afterAll(async () => {
    if (users.length > 0) await pool.query("delete from users where id = any($1)", [users]);
  });

  it("preserves thread/message pagination, ownership, read marker and message idempotency", async () => {
    const owner = await createUser("state-owner");
    const stranger = await createUser("state-stranger");
    users.push(owner, stranger);
    const created = (await service.createThread(UserId(owner), "  My thread  ")) as { thread: { id: string; title: string; read_at: string | null } };
    expect(created.thread.title).toBe("My thread");
    await expect(service.threadDetail(UserId(stranger), created.thread.id)).rejects.toMatchObject({ status: 404 });
    const read = (await service.markThreadRead(UserId(owner), created.thread.id)) as { thread: { read_at: Date | null } };
    expect(read.thread.read_at).toBeInstanceOf(Date);
    const first = await service.createMessage(UserId(owner), created.thread.id, { content: " hello ", client_request_id: "req-1" });
    const replay = await service.createMessage(UserId(owner), created.thread.id, { content: "hello", client_request_id: "req-1" });
    expect([first.status, replay.status]).toEqual([201, 200]);
    const messages = (await service.listMessages(UserId(owner), created.thread.id, { limit: "1" })) as { items: unknown[]; next_cursor: string | null };
    expect(messages.items).toHaveLength(1);
    expect(messages.next_cursor).toBeNull();
    const threads = (await service.listThreads(UserId(owner), { limit: "1" })) as { items: unknown[] };
    expect(threads.items).toHaveLength(1);
  });

  it("preserves run polling queue semantics and durable SSE snapshot/resume framing", async () => {
    const owner = await createUser("run");
    users.push(owner);
    const thread = (await service.createThread(UserId(owner), null)) as { thread: { id: string } };
    const message = await service.createMessage(UserId(owner), thread.thread.id, { content: "hello", client_request_id: "run-1" });
    const runId = (message.body as { run: { id: string } }).run.id;
    const queued = (await service.runDetail(UserId(owner), thread.thread.id, runId)) as { run: { queue_position: number; eta_seconds: number } };
    expect(queued.run.queue_position).toBeGreaterThan(0);
    expect(queued.run.eta_seconds).toBeGreaterThan(0);
    await pool.query("update assistant_runs set status='done', result=$2, updated_at=now() where id=$1", [runId, { kind: "answer", text: "done", citations: [] }]);
    const fresh = await service.openRunEvents(UserId(owner), runId, undefined, new AbortController().signal);
    const frames: string[] = [];
    for await (const frame of fresh.frames) frames.push(frame);
    expect(frames.join("")).toContain("event: assistant.snapshot");
    expect(frames.join("")).toContain("event: assistant.delta");
    expect(frames.join("")).toContain("event: assistant.completed");
    const resumed = await service.openRunEvents(UserId(owner), runId, "1", new AbortController().signal);
    const replayed: string[] = [];
    for await (const frame of resumed.frames) replayed.push(frame);
    expect(replayed.join("")).not.toContain("assistant.snapshot");
    expect(replayed.join("")).not.toContain("assistant.delta");
    expect(replayed.join("")).toContain("assistant.completed");
  });

  it("preserves live thread SSE snapshot and Last-Event-ID cursor", async () => {
    const owner = await createUser("thread-events");
    users.push(owner);
    const thread = (await service.createThread(UserId(owner), null)) as { thread: { id: string } };
    external.threadEvents = [
      { seq: 1, event_type: "message.created", payload: { content: "one" } },
      { seq: 2, event_type: "message.created", payload: { content: "two" } },
    ];
    const abort = new AbortController();
    const stream = await service.openThreadEvents(UserId(owner), thread.thread.id, "1", abort.signal);
    const iterator = stream.frames[Symbol.asyncIterator]();
    const frame = await iterator.next();
    expect(frame.value).toContain("id: 2");
    expect(frame.value).not.toContain("one");
    abort.abort();
    await iterator.return?.();
  });

  it("confirms a generation offer through the generations public port exactly once", async () => {
    const owner = await createUser("generation");
    users.push(owner);
    const thread = (await service.createThread(UserId(owner), null)) as { thread: { id: string } };
    const message = await service.createMessage(UserId(owner), thread.thread.id, { content: "cube", client_request_id: "offer-1" });
    const runId = (message.body as { run: { id: string } }).run.id;
    await pool.query("update assistant_runs set status='done', result=$2 where id=$1", [runId, { kind: "generation_offer", branch: "kzd", prompt_summary: "cube", params: {} }]);
    expect((await service.confirmGeneration(UserId(owner), thread.thread.id, runId)).status).toBe(201);
    expect((await service.confirmGeneration(UserId(owner), thread.thread.id, runId)).status).toBe(200);
    expect(generations.createCalls).toBe(1);
    expect(
      (await pool.query<{ confirmed_generation_id: string }>("select confirmed_generation_id from assistant_runs where id=$1", [runId])).rows[0]?.confirmed_generation_id,
    ).toBe(generations.generationId);
  });

  it("preserves prompt-variants success filtering and degraded fallback contracts", async () => {
    const owner = await createUser("prompt");
    users.push(owner);
    external.promptResult = {
      ok: true,
      draft: {
        normalized_query: "ваза",
        motif: "ваза",
        variants: [
          { label: "Дракон", prompt: "дракон", motif: "дракон", confidence: 0.9 },
          { label: "Ваза", prompt: "ваза с волнами", motif: "ваза", confidence: 0.8 },
        ],
      },
    };
    const result = await service.promptVariants(UserId(owner), { query: "ваза" }, {} as Request);
    expect(result.degraded).toBe(true);
    expect(result.variants).toHaveLength(6);
    expect(result.variants[0]?.label).toBe("Ваза");
    external.promptResult = { ok: false, status: 503, error: "offline" };
    const fallback = await service.promptVariants(UserId(owner), { query: "дракон" }, {} as Request);
    expect(fallback.degraded).toBe(true);
    expect(fallback.variants).toHaveLength(6);
    expect(fallback.variants[0]?.label).toBe("Дракон из силуэтов котиков");
  });
});
