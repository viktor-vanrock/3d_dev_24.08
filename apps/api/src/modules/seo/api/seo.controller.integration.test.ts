import { randomUUID } from "node:crypto";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pool } from "../../../db/client.ts";
import { AppModule } from "../../../nest/app.module.ts";
import { createNestApp } from "../../../nest/bootstrap.ts";

let app: NestExpressApplication;
let baseUrl: string;
const userId = randomUUID();
const modelId = randomUUID();

describe("Nest SEO domain migration", () => {
  beforeAll(async () => {
    process.env.S3_PUBLIC_ENDPOINT = "https://global.s3.example";
    process.env.S3_PUBLIC_URL_STYLE = "global";
    process.env.S3_BUCKET_MODELS = "models-public";
    await pool.query(`insert into users (id, username, display_name, status) values ($1, $2, $3, 'active')`, [userId, `seo-${randomUUID()}`, "SEO Author"]);
    await pool.query(
      `with ids as (
         select gen_random_uuid() as child_id, gen_random_uuid() as model_revision_id,
                gen_random_uuid() as project_revision_id
       ), project as (
         insert into projects (id, owner_id, title, description, primary_model_id, published_revision_id)
         select $1, $2, $3, $4, child_id, project_revision_id from ids
       ), model as (
         insert into models (id, project_id, name, position, latest_revision_id, active_revision_id)
         select child_id, $1, $3, 0, model_revision_id, model_revision_id from ids
       ), revision as (
         insert into model_revisions
           (id, model_id, source_format, status, source_checksum, source_size_bytes, ready_at)
         select model_revision_id, child_id, 'stl', 'ready', decode(repeat('00', 32), 'hex'), 1, now() from ids
       ), publication as (
         insert into project_revisions (id, project_id, content_hash, primary_model_id, metadata_snapshot)
         select project_revision_id, $1, decode(repeat('01', 32), 'hex'), child_id,
                jsonb_build_object('schema', 'project-publication.v1', 'title', $3, 'description', $4, 'tags', '[]'::jsonb, 'repo_url', null, 'owner_id', $2)
           from ids
       ), publication_model as (
         insert into project_revision_models (project_revision_id, project_id, model_id, model_revision_id, position)
         select project_revision_id, $1, child_id, model_revision_id, 0 from ids
       ), blob as (
         insert into storage_blobs (owner_id, checksum, size_bytes, s3_key, state)
         values ($2, decode(repeat('02', 32), 'hex'), 1, $5, 'ready') returning id
       )
       insert into model_revision_files
         (model_revision_id, role, is_source, blob_id, original_filename, mime_type, size_bytes, checksum)
       select model_revision_id, 'thumbnail', false, blob.id, 'thumbnail.webp', 'image/webp', 1,
              decode(repeat('02', 32), 'hex') from ids cross join blob`,
      [modelId, userId, "SEO <Project>", "# Useful [model](https://example.test)", `public/models/${modelId}/thumbnail.webp`],
    );

    app = await createNestApp(AppModule);
    await app.listen(0, "127.0.0.1");
    const address = (app.getHttpServer() as { address(): string | { port: number } | null }).address();
    if (address === null || typeof address === "string") throw new Error("Nest SEO test server did not bind");
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await app?.close();
    await pool.query(`update projects set published_revision_id = null where id = $1`, [modelId]);
    await pool.query(`delete from project_revisions where project_id = $1`, [modelId]);
    await pool.query(`delete from projects where id = $1`, [modelId]);
    await pool.query(`delete from storage_blobs where owner_id = $1`, [userId]);
    await pool.query(`delete from users where id = $1`, [userId]);
    delete process.env.S3_PUBLIC_ENDPOINT;
    delete process.env.S3_PUBLIC_URL_STYLE;
    delete process.env.S3_BUCKET_MODELS;
  });

  it("keeps robots and sitemap public with the legacy cache contracts", async () => {
    const robots = await fetch(`${baseUrl}/robots.txt`);
    expect(robots.status).toBe(200);
    expect(robots.headers.get("cache-control")).toBe("public, max-age=3600");
    expect(await robots.text()).toContain("Disallow: /models/_index/scan");

    const sitemap = await fetch(`${baseUrl}/sitemap.xml`);
    expect(sitemap.status).toBe(200);
    expect(sitemap.headers.get("cache-control")).toBe("public, max-age=600");
    const xml = await sitemap.text();
    expect(xml).toContain(`/project/${modelId}`);
    expect(xml).toContain("<lastmod>");
  });

  it("renders escaped model metadata through owner public read ports", async () => {
    const response = await fetch(`${baseUrl}/seo/meta?path=${encodeURIComponent(`/project/${modelId}`)}`);
    expect(response.status).toBe(200);
    expect(response.headers.get("x-robots-tag")).toBe("index");
    const html = await response.text();
    expect(html).toContain("<title>SEO &lt;Project&gt; — 3mf.tech</title>");
    expect(html).toContain("SEO Author · Useful model");
    expect(html).toContain(`/seo/models/${modelId}/og.webp`);
  });

  it("uses the versioned error envelope for non-existent metadata", async () => {
    const response = await fetch(`${baseUrl}/seo/meta?path=/unknown`);
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "http.not_found.v1" } });
  });

  it("redirects a published thumbnail to configured public storage", async () => {
    const response = await fetch(`${baseUrl}/seo/models/${modelId}/og.webp`, { redirect: "manual" });
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(`https://global.s3.example/models-public/public/models/${modelId}/thumbnail.webp`);
  });
});
