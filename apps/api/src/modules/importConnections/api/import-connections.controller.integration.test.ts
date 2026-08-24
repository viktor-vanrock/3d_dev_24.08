import { randomUUID } from "node:crypto";
import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR, APP_PIPE } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { SignJWT } from "jose";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { pool } from "../../../db/client.ts";
import { AuthGuard } from "../../../nest/auth/auth.guard.ts";
import { SessionVerifier } from "../../../nest/auth/session-verifier.ts";
import { createNestApp } from "../../../nest/bootstrap.ts";
import { ApiExceptionFilter } from "../../../nest/errors/api-exception.filter.ts";
import { DatabaseModule } from "../../../nest/database/database.module.ts";
import { CorrelationInterceptor } from "../../../nest/observability/correlation.interceptor.ts";
import { RequestContext } from "../../../nest/observability/request-context.ts";
import { RuntimeLogger } from "../../../nest/observability/runtime-logger.ts";
import { createApiValidationPipe } from "../../../nest/validation/api-validation.pipe.ts";
import { ImportConnectionsService } from "../application/import-connections.service.ts";
import { ImportConnectionsRepository } from "../infrastructure/import-connections.repository.ts";
import { IMPORT_CONNECTIONS_EXTERNAL_PORT, type ImportConnectionsExternalPort } from "../public/index.ts";
import { IMPORT_CONNECTIONS_PORT } from "../public/index.ts";
import { ImportConnectionsController } from "./import-connections.controller.ts";

const JWT_SECRET = "nest-import-connections-test-secret";
const canRunIntegration = Boolean(process.env.DATABASE_URL);
const userIds: string[] = [];
const modelIds: string[] = [];
let app: NestExpressApplication;
let baseUrl: string;
let externalFailure: "none" | "provider" | "decrypt" = "none";
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
const fakeExternal: ImportConnectionsExternalPort = {
  validateCredentials: () => (externalFailure === "provider" ? Promise.reject(new Error("provider secret")) : Promise.resolve([])),
  listModels: () => Promise.resolve([]),
  encryptCredentials: () => Buffer.from("encrypted"),
  decryptCredentials: () => {
    if (externalFailure === "decrypt") throw new Error("decrypt secret");
    return "key";
  },
};

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }), DatabaseModule],
  controllers: [ImportConnectionsController],
  providers: [
    SessionVerifier,
    RequestContext,
    RuntimeLogger,
    ImportConnectionsRepository,
    ImportConnectionsService,
    { provide: IMPORT_CONNECTIONS_PORT, useExisting: ImportConnectionsService },
    { provide: IMPORT_CONNECTIONS_EXTERNAL_PORT, useValue: fakeExternal },
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_INTERCEPTOR, useClass: CorrelationInterceptor },
    { provide: APP_FILTER, useClass: ApiExceptionFilter },
    { provide: APP_PIPE, useFactory: createApiValidationPipe },
  ],
})
class ImportConnectionsTestModule {}

async function createUser(): Promise<string> {
  const result = await pool.query<{ id: string }>(`insert into users (username) values ($1) returning id`, [`nest-import-connection-${randomUUID()}`]);
  const id = result.rows[0]!.id;
  userIds.push(id);
  return id;
}

async function createConnection(userId: string): Promise<string> {
  const result = await pool.query<{ id: string }>(`insert into import_connections (user_id, source_platform, credential_enc) values ($1, 'cults3d', $2) returning id`, [
    userId,
    Buffer.from("test"),
  ]);
  return result.rows[0]!.id;
}

async function createBinding(userId: string, connectionId: string): Promise<string> {
  // Project/Model split (task 6.7): modelId is the Project id; import_bindings is child-keyed.
  const model = await pool.query<{ id: string; child_id: string }>(
    `with ids as (
       select gen_random_uuid() as project_id, gen_random_uuid() as child_id, gen_random_uuid() as revision_id
     ), p as (
       insert into projects (id, owner_id, title, primary_model_id)
       select project_id, $1, 'imported', child_id from ids returning id
     ), m as (
       insert into models (id, project_id, name, position, latest_revision_id, active_revision_id)
       select child_id, project_id, 'imported', 0, revision_id, revision_id from ids returning id, project_id
     ), r as (
       insert into model_revisions (id, model_id, source_format, status, source_checksum, source_size_bytes, ready_at)
       select revision_id, child_id, 'stl', 'ready', decode(repeat('00', 32), 'hex'), 0, now() from ids
     )
     select project_id as id, id as child_id from m`,
    [userId],
  );
  const modelId = model.rows[0]!.id;
  modelIds.push(modelId);
  await pool.query(
    `insert into import_bindings (model_id, connection_id, user_id, source_platform, external_id, original_url)
     values ($1, $2, $3, 'cults3d', $4, 'https://cults3d.com/x')`,
    [model.rows[0]!.child_id, connectionId, userId, randomUUID()],
  );
  return modelId;
}

async function cookie(userId: string): Promise<string> {
  const token = await new SignJWT({ username: "import-connection-tester" })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setExpirationTime("5m")
    .sign(new TextEncoder().encode(JWT_SECRET));
  return `portal_session=${token}`;
}

describe.skipIf(!canRunIntegration)("Nest singular import-connections migration", () => {
  beforeAll(async () => {
    process.env.JWT_SECRET = JWT_SECRET;
    process.env.AUTH_ENCRYPTION_KEY ??= "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
    app = await createNestApp(ImportConnectionsTestModule);
    await app.listen(0, "127.0.0.1");
    const address = (app.getHttpServer() as { address(): string | { port: number } | null }).address();
    if (address === null || typeof address === "string") throw new Error("Nest import-connections test server did not bind");
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    externalFailure = "none";
    if (modelIds.length > 0) await pool.query(`delete from projects where id = any($1::uuid[])`, [modelIds.splice(0)]);
    if (userIds.length > 0) await pool.query(`delete from users where id = any($1::uuid[])`, [userIds.splice(0)]);
  });

  afterAll(async () => {
    if (app !== undefined) await app.close();
    delete process.env.JWT_SECRET;
  });

  it("keeps all five routes authenticated with the versioned error envelope", async () => {
    const id = randomUUID();
    for (const responsePromise of [
      fetch(`${baseUrl}/me/import-connections`),
      fetch(`${baseUrl}/me/import-connections`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }),
      fetch(`${baseUrl}/me/import-connections/${id}/models`),
      fetch(`${baseUrl}/me/import-connections/${id}/challenge`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }),
      fetch(`${baseUrl}/me/import-connections/${id}/verify`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }),
    ]) {
      const response = await responsePromise;
      expect(response.status).toBe(401);
      const body: unknown = await response.json();
      expect(body).toMatchObject({ error: { code: "auth.unauthorized.v1" } });
      expect(isRecord(body) && isRecord(body.error) && typeof body.error.requestId === "string").toBe(true);
    }
  });

  it("preserves legacy 400 and 404 decisions with the common error envelope", async () => {
    const headers = { cookie: await cookie(await createUser()), "content-type": "application/json" };
    const unsupported = await fetch(`${baseUrl}/me/import-connections`, {
      method: "POST",
      headers,
      body: JSON.stringify({ source_platform: "printables", api_key: "x" }),
    });
    expect(unsupported.status).toBe(400);
    await expect(unsupported.json()).resolves.toMatchObject({ error: { code: "http.bad_request.v1" } });

    const unknownField = await fetch(`${baseUrl}/me/import-connections`, {
      method: "POST",
      headers,
      body: JSON.stringify({ source_platform: "cults3d", api_key: "x", legacy_extra: true }),
    });
    expect(unknownField.status).toBe(422);
    await expect(unknownField.json()).resolves.toMatchObject({ error: { code: "validation.invalid.v1" } });

    const missing = await fetch(`${baseUrl}/me/import-connections/not-a-uuid/models`, { headers });
    expect(missing.status).toBe(404);
    await expect(missing.json()).resolves.toMatchObject({ error: { code: "http.not_found.v1" } });
  });

  it("sanitizes generic provider and decrypt failures into the versioned 502 envelope", async () => {
    const userId = await createUser();
    const headers = { cookie: await cookie(userId), "content-type": "application/json" };
    externalFailure = "provider";
    const provider = await fetch(`${baseUrl}/me/import-connections`, {
      method: "POST",
      headers,
      body: JSON.stringify({ source_platform: "cults3d", api_key: "secret" }),
    });
    expect(provider.status).toBe(502);
    const providerBody = await provider.text();
    expect(providerBody).toContain('"code":"http.upstream.v1"');
    expect(providerBody).toContain('"requestId":');
    expect(providerBody).not.toContain("provider secret");

    const connectionId = await createConnection(userId);
    externalFailure = "decrypt";
    const decrypt = await fetch(`${baseUrl}/me/import-connections/${connectionId}/models`, { headers });
    expect(decrypt.status).toBe(502);
    const decryptBody = await decrypt.text();
    expect(decryptBody).toContain('"code":"http.upstream.v1"');
    expect(decryptBody).toContain('"requestId":');
    expect(decryptBody).not.toContain("decrypt secret");
  });

  it("keeps challenge mismatch as 200 rejected and updates connection plus bindings atomically", async () => {
    const userId = await createUser();
    const connectionId = await createConnection(userId);
    const modelId = await createBinding(userId, connectionId);
    const headers = { cookie: await cookie(userId), "content-type": "application/json" };

    const challenged = await fetch(`${baseUrl}/me/import-connections/${connectionId}/challenge`, {
      method: "POST",
      headers,
      body: JSON.stringify({ target: "bio" }),
    });
    expect(challenged.status).toBe(201);
    const challengeBody: unknown = await challenged.json();
    expect(isRecord(challengeBody) && typeof challengeBody.token === "string" && /^3mf-verify-/.test(challengeBody.token)).toBe(true);

    const verified = await fetch(`${baseUrl}/me/import-connections/${connectionId}/verify`, {
      method: "POST",
      headers,
      body: JSON.stringify({ observed_text: "mismatch" }),
    });
    expect(verified.status).toBe(200);
    await expect(verified.json()).resolves.toEqual({ ownership_status: "rejected" });

    const connection = await pool.query<{ ownership_status: string }>(`select ownership_status from import_connections where id = $1`, [connectionId]);
    const binding = await pool.query<{ ownership_status: string }>(`select ownership_status from import_bindings where model_id = (select id from models where project_id = $1)`, [
      modelId,
    ]);
    expect(connection.rows[0]!.ownership_status).toBe("rejected");
    expect(binding.rows[0]!.ownership_status).toBe("rejected");

    const list = await fetch(`${baseUrl}/me/import-connections`, { headers });
    expect(list.status).toBe(200);
    await expect(list.json()).resolves.toMatchObject({
      connections: [expect.objectContaining({ id: connectionId, ownership_status: "rejected" })],
      bindings: [expect.objectContaining({ model_id: modelId, ownership_status: "rejected" })],
    });
  });
});
