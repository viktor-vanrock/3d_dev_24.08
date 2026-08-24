import { Global, Injectable, Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR, APP_PIPE } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { SignJWT } from "jose";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pool } from "../../../db/client.ts";
import { AuthGuard } from "../../../nest/auth/auth.guard.ts";
import { SessionVerifier } from "../../../nest/auth/session-verifier.ts";
import { createNestApp } from "../../../nest/bootstrap.ts";
import { validateRuntimeEnvironment } from "../../../nest/config/runtime-config.ts";
import { DatabaseModule } from "../../../nest/database/database.module.ts";
import { ApiExceptionFilter } from "../../../nest/errors/api-exception.filter.ts";
import { CorrelationInterceptor } from "../../../nest/observability/correlation.interceptor.ts";
import { LoggingInterceptor } from "../../../nest/observability/logging.interceptor.ts";
import { RequestContext } from "../../../nest/observability/request-context.ts";
import { RuntimeLogger } from "../../../nest/observability/runtime-logger.ts";
import { createApiValidationPipe } from "../../../nest/validation/api-validation.pipe.ts";
import type { UserId } from "../../_kernel/brandedIds.ts";
import type { GenerationResponse } from "../../generations/public/index.ts";
import { ASSISTANT_EXTERNAL_PORT, ASSISTANT_GENERATIONS_PORT, type AssistantExternalPort, type AssistantGenerationsPort } from "../public/index.ts";
import { AssistantModule } from "../assistant.module.ts";

const JWT_SECRET = process.env.JWT_SECRET ?? "nest-assistant-integration-secret";

@Injectable()
class TestExternal implements AssistantExternalPort {
  assertPromptVariantsRateLimit(): Promise<void> {
    return Promise.resolve();
  }
  isPromptBlocked(): boolean {
    return false;
  }
  searchCatalogMatches() {
    return Promise.resolve([]);
  }
  requestPromptVariants() {
    return Promise.resolve({ ok: false as const, status: 503, error: "offline" });
  }
  loadThreadEventsAfter() {
    return Promise.resolve([]);
  }
}

@Injectable()
class TestGenerations implements AssistantGenerationsPort {
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
  create(_userId: UserId, _body: Readonly<Record<string, unknown>>) {
    return Promise.resolve({ status: 503, body: { generation: this.generation("00000000-0000-4000-8000-000000000001") } });
  }
  detail(_userId: UserId, generationId: string) {
    return Promise.resolve({ generation: this.generation(generationId) });
  }
}

@Global()
@Module({
  providers: [
    TestExternal,
    TestGenerations,
    { provide: ASSISTANT_EXTERNAL_PORT, useExisting: TestExternal },
    { provide: ASSISTANT_GENERATIONS_PORT, useExisting: TestGenerations },
  ],
  exports: [ASSISTANT_EXTERNAL_PORT, ASSISTANT_GENERATIONS_PORT],
})
class AssistantTestAdaptersModule {}

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true, validate: validateRuntimeEnvironment }), DatabaseModule, AssistantTestAdaptersModule, AssistantModule],
  providers: [
    RequestContext,
    RuntimeLogger,
    SessionVerifier,
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_INTERCEPTOR, useClass: CorrelationInterceptor },
    { provide: APP_INTERCEPTOR, useClass: LoggingInterceptor },
    { provide: APP_FILTER, useClass: ApiExceptionFilter },
    { provide: APP_PIPE, useFactory: createApiValidationPipe },
  ],
})
class AssistantTestAppModule {}

async function sessionCookie(userId: string): Promise<string> {
  const token = await new SignJWT({ username: "assistant-http" })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setExpirationTime("5m")
    .sign(new TextEncoder().encode(JWT_SECRET));
  return `portal_session=${token}`;
}

describe("Nest assistant HTTP contract", () => {
  let app: NestExpressApplication;
  let baseUrl: string;
  let userId: string;
  beforeAll(async () => {
    process.env.JWT_SECRET = JWT_SECRET;
    process.env.NODE_ENV = "test";
    userId = (await pool.query<{ id: string }>("insert into users (username) values ($1) returning id", [`assistant-http-${Date.now()}`])).rows[0]!.id;
    app = await createNestApp(AssistantTestAppModule);
    await app.listen(0, "127.0.0.1");
    const address = (app.getHttpServer() as { address(): string | { port: number } | null }).address();
    if (address === null || typeof address === "string") throw new Error("assistant test server did not bind");
    baseUrl = `http://127.0.0.1:${address.port}`;
  });
  afterAll(async () => {
    await app.close();
    await pool.query("delete from users where id=$1", [userId]);
    delete process.env.JWT_SECRET;
  });

  it("publishes all 11 routes and versioned auth errors in OpenAPI", async () => {
    const unauthorized = await fetch(`${baseUrl}/assistant/threads`);
    expect(unauthorized.status).toBe(401);
    const envelope = (await unauthorized.json()) as { error?: { code?: unknown; requestId?: unknown } };
    expect(envelope.error?.code).toBe("auth.unauthorized.v1");
    expect(typeof envelope.error?.requestId).toBe("string");
    const document = (await (await fetch(`${baseUrl}/openapi.json`)).json()) as { paths: Record<string, Record<string, unknown>> };
    const operations = Object.entries(document.paths)
      .filter(([path]) => path.startsWith("/assistant/"))
      .reduce((count, [, methods]) => count + Object.keys(methods).length, 0);
    expect(operations).toBe(11);
  });

  it("preserves create/replay/poll/SSE status and framing", async () => {
    const headers = { cookie: await sessionCookie(userId), "content-type": "application/json" };
    const created = await fetch(`${baseUrl}/assistant/threads`, { method: "POST", headers, body: JSON.stringify({ title: "HTTP thread" }) });
    expect(created.status).toBe(201);
    const threadId = ((await created.json()) as { thread: { id: string } }).thread.id;
    const first = await fetch(`${baseUrl}/assistant/threads/${threadId}/messages`, {
      method: "POST",
      headers,
      body: JSON.stringify({ content: "hello", client_request_id: "http-1" }),
    });
    expect(first.status).toBe(201);
    const firstBody = (await first.json()) as { run: { id: string } };
    const replay = await fetch(`${baseUrl}/assistant/threads/${threadId}/messages`, {
      method: "POST",
      headers,
      body: JSON.stringify({ content: "hello", client_request_id: "http-1" }),
    });
    expect(replay.status).toBe(200);
    const polling = await fetch(`${baseUrl}/assistant/threads/${threadId}/runs/${firstBody.run.id}`, { headers: { cookie: headers.cookie } });
    expect(polling.status).toBe(200);
    await pool.query("update assistant_runs set status='done', result=$2 where id=$1", [firstBody.run.id, { kind: "answer", text: "http done", citations: [] }]);
    const events = await fetch(`${baseUrl}/assistant/runs/${firstBody.run.id}/events`, { headers: { cookie: headers.cookie } });
    expect(events.status).toBe(200);
    expect(events.headers.get("content-type")).toContain("text/event-stream");
    const text = await events.text();
    expect(text).toContain("event: assistant.snapshot");
    expect(text).toContain("event: assistant.delta");
    expect(text).toContain("event: assistant.completed");
  });
});
