import { createHash } from "node:crypto";
import type { PoolClient } from "pg";

import { readJsonArray } from "./read-snapshot.ts";
import type { ForgeNews, SectionReport } from "./types.ts";
import { isObject, jsonArray, stringValue } from "./types.ts";

function parseNews(value: unknown): ForgeNews | null {
  if (!isObject(value) || value.kind !== "news" || value.outcome !== "staged") return null;
  const publisher = stringValue(value.publisher);
  const url = stringValue(value.url);
  const title = stringValue(value.title);
  const bodyMarkdown = stringValue(value.body_markdown);
  const images = Array.isArray(value.images) && value.images.every((image) => typeof image === "string") ? value.images : null;
  const claims = jsonArray(value.claims);
  const extractor = stringValue(value.extractor);
  const verifier = stringValue(value.verifier);
  if (!publisher || !url || !title || !bodyMarkdown || !images || !claims || !extractor || !verifier) return null;
  return { publisher, url, title, dek: stringValue(value.dek), bodyMarkdown, published: stringValue(value.published), images, claims, extractor, verifier };
}

export async function loadNews(sourceDirectory: string): Promise<{ readonly records: readonly ForgeNews[]; readonly rejected: number }> {
  const input = await readJsonArray(sourceDirectory, "news.json");
  const records: ForgeNews[] = [];
  let rejected = 0;
  for (const value of input) {
    const record = parseNews(value);
    if (record) records.push(record); else rejected += 1;
  }
  return { records, rejected };
}

export async function importNews(client: PoolClient | null, sourceDirectory: string, authorId: string | null, communityId: string | null, status: "draft" | "visible"): Promise<SectionReport> {
  const loaded = await loadNews(sourceDirectory);
  if (client && !authorId) throw new Error("news apply requires --author-id");
  let inserted = 0;
  let unchanged = 0;
  if (client) await client.query(`select pg_advisory_xact_lock(hashtext('forge-catalog-news-import'))`);
  for (const record of loaded.records) {
    if (!client || !authorId) continue;
    const fingerprint = `sha256:${createHash("sha256").update(record.url).digest("hex")}`;
    const existing = await client.query(
      `select 1 from feed_posts where source_fingerprint=$1 and community_id is not distinct from $2::uuid limit 1`,
      [fingerprint, communityId],
    );
    if ((existing.rowCount ?? 0) > 0) {
      unchanged += 1;
      continue;
    }
    const body = record.dek ? `${record.dek}\n\n${record.bodyMarkdown}` : record.bodyMarkdown;
    const result = await client.query(
      `insert into feed_posts(author_id,community_id,type,title,body,status,source_url,source_fingerprint,ingest_provider,ingest_model,ingest_prompt_version,created_at)
       values($1,$2,'text',$3,$4,$9,$5,$6,'forge-snapshot',$7,'forge-catalog-2026-09-04',coalesce($8::timestamptz,now()))
       on conflict(community_id,source_fingerprint) where source_fingerprint is not null do nothing`,
      [authorId, communityId, record.title.slice(0, 300), body, record.url, fingerprint, `${record.extractor}+${record.verifier}`, record.published, status],
    );
    if ((result.rowCount ?? 0) > 0) inserted += 1; else unchanged += 1;
  }
  return { found: loaded.records.length + loaded.rejected, accepted: loaded.records.length, quarantined: 0, rejected: loaded.rejected, inserted, updated: 0, unchanged: client ? unchanged : loaded.records.length, warnings: [`news status: ${status}`] };
}
