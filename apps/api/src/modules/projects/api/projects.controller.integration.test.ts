import { randomUUID } from "node:crypto";
import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR, APP_PIPE } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { SignJWT } from "jose";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AuthGuard } from "../../../nest/auth/auth.guard.ts";
import { createNestApp } from "../../../nest/bootstrap.ts";
import { DATABASE_POOL } from "../../../nest/database/database.constants.ts";
import { ApiExceptionFilter } from "../../../nest/errors/api-exception.filter.ts";
import { CorrelationInterceptor } from "../../../nest/observability/correlation.interceptor.ts";
import { RequestContext } from "../../../nest/observability/request-context.ts";
import { RuntimeLogger } from "../../../nest/observability/runtime-logger.ts";
import { SessionVerifier } from "../../../nest/auth/session-verifier.ts";
import { createApiValidationPipe } from "../../../nest/validation/api-validation.pipe.ts";
import { ProjectsModule } from "../projects.module.ts";

const JWT_SECRET = "project-api-v1-integration-secret";

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }), ProjectsModule],
  providers: [
    RequestContext,
    RuntimeLogger,
    SessionVerifier,
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_INTERCEPTOR, useClass: CorrelationInterceptor },
    { provide: APP_FILTER, useClass: ApiExceptionFilter },
    { provide: APP_PIPE, useFactory: createApiValidationPipe },
  ],
})
class ProjectApiIntegrationModule {}

async function token(userId: string, username: string): Promise<string> {
  return new SignJWT({ username, sv: 1 }).setProtectedHeader({ alg: "HS256" }).setSubject(userId).sign(new TextEncoder().encode(JWT_SECRET));
}

describe.skipIf(!process.env.DATABASE_URL)("Project API v1 HTTP integration", () => {
  let app: NestExpressApplication;
  let baseUrl: string;
  let pool: Pool;
  const ownerId = randomUUID();
  const outsiderId = randomUUID();
  let ownerToken: string;
  let outsiderToken: string;
  let projectId = "";
  let modelId = "";
  let revisionId = "";

  beforeAll(async () => {
    process.env.JWT_SECRET = JWT_SECRET;
    process.env.NODE_ENV = "test";
    delete process.env.CLOSED_DEV;
    delete process.env.PORTAL_PUBLIC;
    app = await createNestApp(ProjectApiIntegrationModule);
    pool = app.get<Pool>(DATABASE_POOL);
    await pool.query("insert into users(id, username) values ($1, $2), ($3, $4)", [ownerId, `project-owner-${ownerId}`, outsiderId, `project-outsider-${outsiderId}`]);
    ownerToken = await token(ownerId, `project-owner-${ownerId}`);
    outsiderToken = await token(outsiderId, `project-outsider-${outsiderId}`);
    await app.listen(0, "127.0.0.1");
    const address = (app.getHttpServer() as { address(): string | { port: number } | null }).address();
    if (address === null || typeof address === "string") throw new Error("Project API test server did not bind");
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    if (projectId !== "") {
      const client = await pool.connect();
      try {
        await client.query("begin");
        await client.query("set constraints all deferred");
        await client.query("update projects set published_revision_id = null, primary_model_id = null where id = $1", [projectId]);
        await client.query("delete from project_revision_models where project_id = $1", [projectId]);
        await client.query("delete from project_revisions where project_id = $1", [projectId]);
        await client.query("delete from outbox_events where payload->>'project_id' = $1", [projectId]);
        await client.query("delete from models where project_id = $1", [projectId]);
        await client.query("delete from projects where id = $1", [projectId]);
        await client.query("commit");
      } catch (error) {
        await client.query("rollback");
        throw error;
      } finally {
        client.release();
      }
    }
    await pool.query("delete from idempotency_records where actor_id = any($1::uuid[])", [[ownerId, outsiderId]]);
    await pool.query("delete from storage_blobs where owner_id = any($1::uuid[])", [[ownerId, outsiderId]]);
    await pool.query("delete from users where id = any($1::uuid[])", [[ownerId, outsiderId]]);
    await app.close();
    delete process.env.JWT_SECRET;
  });

  it("requires auth and creates/replays a zero-Model draft with Location and ETag", async () => {
    const absent = await fetch(`${baseUrl}/projects/owned`);
    expect(absent.status).toBe(401);
    expect(((await absent.json()) as { error: { code: string } }).error.code).toBe("auth.unauthenticated.v1");

    const create = () =>
      fetch(`${baseUrl}/projects`, {
        method: "POST",
        headers: { authorization: `Bearer ${ownerToken}`, "content-type": "application/json", "idempotency-key": "create-project-v1" },
        body: JSON.stringify({ title: "Pinned title", description: null, tags: ["fixture"] }),
      });
    const first = await create();
    expect(first.status).toBe(201);
    expect(first.headers.get("etag")).toBe('"1"');
    const firstBody = (await first.json()) as { contract_version: string; project: { id: string; models_count: number } };
    projectId = firstBody.project.id;
    expect(firstBody).toMatchObject({ contract_version: "project-api.v1", project: { models_count: 0 } });
    expect(first.headers.get("location")).toBe(`/projects/${projectId}/draft`);

    const replay = await create();
    expect(replay.status).toBe(201);
    expect(((await replay.json()) as { project: { id: string } }).project.id).toBe(projectId);
    expect(await pool.query("select count(*)::int as n from projects where owner_id = $1", [ownerId]).then((result) => result.rows[0].n)).toBe(1);
  });

  it("keeps owner reads private and rejects stale or empty PATCH", async () => {
    const publicDraft = await fetch(`${baseUrl}/projects/${projectId}`);
    expect(publicDraft.status).toBe(404);

    const outsider = await fetch(`${baseUrl}/projects/${projectId}/draft`, { headers: { authorization: `Bearer ${outsiderToken}` } });
    expect(outsider.status).toBe(404);
    expect(((await outsider.json()) as { error: { code: string } }).error.code).toBe("project.not_found.v1");

    const empty = await fetch(`${baseUrl}/projects/${projectId}`, {
      method: "PATCH",
      headers: { authorization: `Bearer ${ownerToken}`, "content-type": "application/json", "if-match": '"1"' },
      body: "{}",
    });
    expect(empty.status).toBe(400);

    const stale = await fetch(`${baseUrl}/projects/${projectId}`, {
      method: "PATCH",
      headers: { authorization: `Bearer ${ownerToken}`, "content-type": "application/json", "if-match": '"99"' },
      body: JSON.stringify({ description: "stale" }),
    });
    expect(stale.status).toBe(409);
    expect(((await stale.json()) as { error: { code: string } }).error.code).toBe("project.version_conflict.v1");

    const updated = await fetch(`${baseUrl}/projects/${projectId}`, {
      method: "PATCH",
      headers: { authorization: `Bearer ${ownerToken}`, "content-type": "application/json", "if-match": '"1"' },
      body: JSON.stringify({ description: "draft description" }),
    });
    expect(updated.status).toBe(200);
    expect(updated.headers.get("etag")).toBe('"2"');
  });

  it("reuses unchanged publication and keeps public reads pinned across draft edits", async () => {
    modelId = randomUUID();
    revisionId = randomUUID();
    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query("set constraints all deferred");
      await client.query("insert into models(id, project_id, name, position, latest_revision_id, active_revision_id) values ($1, $2, 'Primary', 0, $3, $3)", [
        modelId,
        projectId,
        revisionId,
      ]);
      await client.query(
        `insert into model_revisions(id, model_id, status, source_format, source_checksum, source_size_bytes, ready_at)
         values ($1, $2, 'ready', 'stl', decode(repeat('44', 32), 'hex'), 12, now())`,
        [revisionId, modelId],
      );
      const blob = await client.query<{ id: string }>(
        `insert into storage_blobs(owner_id, checksum, size_bytes, s3_key, state)
         values ($1, decode(repeat('44', 32), 'hex'), 12, $2, 'ready') returning id`,
        [ownerId, `protected/test/${revisionId}`],
      );
      await client.query(
        `insert into model_revision_files(model_revision_id, role, is_source, blob_id, original_filename, mime_type, size_bytes, checksum)
         values ($1, 'source', true, $2, 'fixture.stl', 'model/stl', 12, decode(repeat('44', 32), 'hex'))`,
        [revisionId, blob.rows[0]!.id],
      );
      await client.query("update projects set primary_model_id = $2, version = version + 1 where id = $1", [projectId, modelId]);
      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }

    const publish = (etag: string) =>
      fetch(`${baseUrl}/projects/${projectId}/publication`, {
        method: "PUT",
        headers: { authorization: `Bearer ${ownerToken}`, "if-match": etag },
      });
    const first = await publish('"3"');
    expect(first.status).toBe(200);
    expect(first.headers.get("etag")).toBe('"4"');
    const firstBody = (await first.json()) as { publication: { project_revision_id: string } };

    const repeated = await publish('"4"');
    expect(repeated.status).toBe(200);
    expect(repeated.headers.get("etag")).toBe('"4"');
    expect(((await repeated.json()) as { publication: { project_revision_id: string } }).publication.project_revision_id).toBe(firstBody.publication.project_revision_id);

    const published = await fetch(`${baseUrl}/projects/${projectId}`);
    expect(published.status).toBe(200);
    expect(((await published.json()) as { project: { title: string } }).project.title).toBe("Pinned title");

    const draftUpdate = await fetch(`${baseUrl}/projects/${projectId}`, {
      method: "PATCH",
      headers: { authorization: `Bearer ${ownerToken}`, "content-type": "application/json", "if-match": '"4"' },
      body: JSON.stringify({ title: "Unpublished draft title" }),
    });
    expect(draftUpdate.headers.get("etag")).toBe('"5"');
    expect(((await fetch(`${baseUrl}/projects/${projectId}`).then((response) => response.json())) as { project: { title: string } }).project.title).toBe("Pinned title");

    const clear = await fetch(`${baseUrl}/projects/${projectId}/publication`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${ownerToken}`, "if-match": '"5"' },
    });
    expect(clear.status).toBe(204);
    expect(clear.headers.get("etag")).toBe('"6"');
    expect(await clear.text()).toBe("");
    expect((await fetch(`${baseUrl}/projects/${projectId}`)).status).toBe(404);
  });
});
