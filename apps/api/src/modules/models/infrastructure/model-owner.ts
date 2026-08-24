import type { QueryResult, QueryResultRow } from "pg";
import { pool } from "../../../db/client.ts";
import { ensureOwnedTags } from "../../community/public/index.ts";

export interface ModelOwnerExecutor {
  query<R extends QueryResultRow = QueryResultRow>(text: string, values?: readonly unknown[]): Promise<QueryResult<R>>;
}

function executor(override?: ModelOwnerExecutor): ModelOwnerExecutor {
  return override ?? pool;
}

export interface OwnedGenerationDraft {
  readonly id: string;
  readonly title: string;
  readonly source_format: string;
  readonly status: string;
  readonly craft: string;
}

export async function projectIdForOwnedChildModel(childModelId: string, tx?: ModelOwnerExecutor): Promise<string> {
  const result = await executor(tx).query<{ project_id: string }>(`select project_id from models where id = $1`, [childModelId]);
  const row = result.rows[0];
  if (row === undefined) throw new Error("owned child model was not found");
  return row.project_id;
}

export async function childModelIdForOwnedProject(projectId: string, tx?: ModelOwnerExecutor): Promise<string> {
  const result = await executor(tx).query<{ id: string }>(`select id from models where project_id = $1 order by position, id limit 1`, [projectId]);
  const row = result.rows[0];
  if (row === undefined) throw new Error("owned project has no child model");
  return row.id;
}

export async function findOwnedGenerationDraft(sourceGenerationId: string, tx?: ModelOwnerExecutor): Promise<OwnedGenerationDraft | null> {
  const result = await executor(tx).query<OwnedGenerationDraft>(
    `select project.id, project.title, revision.source_format, revision.status, revision.craft
       from model_revisions revision
       join models model on model.id = revision.model_id and model.latest_revision_id = revision.id
       join projects project on project.id = model.project_id
      where revision.source_generation_id = $1 and project.deleted_at is null`,
    [sourceGenerationId],
  );
  return result.rows[0] ?? null;
}

export async function createOwnedGenerationDraft(
  tx: ModelOwnerExecutor,
  input: { ownerId: string; title: string; sourceFormat: "stl" | "zip"; sourceGenerationId: string },
): Promise<string> {
  const result = await tx.query<{ id: string }>(
    `with ids as (
       select gen_random_uuid() as project_id, gen_random_uuid() as child_id, gen_random_uuid() as revision_id
     ), project as (
       insert into projects (id, owner_id, title, primary_model_id)
       select project_id, $1, $2, child_id from ids returning id
     ), model as (
       insert into models (id, project_id, name, position, latest_revision_id, active_revision_id)
       select child_id, project_id, $2, 0, revision_id, revision_id from ids
     ), revision as (
       insert into model_revisions
         (id, model_id, source_format, status, source_generation_id, source_checksum, source_size_bytes, ready_at)
       select revision_id, child_id, $3, 'ready', $4, decode(repeat('00', 32), 'hex'), 0, now() from ids
     )
     select id from project`,
    [input.ownerId, input.title, input.sourceFormat, input.sourceGenerationId],
  );
  const row = result.rows[0];
  if (row === undefined) throw new Error("model insert returned no row");
  return row.id;
}

export async function deleteOwnedModel(modelId: string, tx?: ModelOwnerExecutor): Promise<void> {
  await executor(tx).query(`delete from projects where id = $1`, [modelId]);
}

export async function createOwnedImportedModel(
  tx: ModelOwnerExecutor,
  input: { ownerId: string; title: string; description: string | null; sourceFormat: string },
): Promise<string> {
  const result = await tx.query<{ id: string }>(
    `with ids as (
       select gen_random_uuid() as project_id, gen_random_uuid() as child_id, gen_random_uuid() as revision_id
     ), project as (
       insert into projects (id, owner_id, title, description, primary_model_id)
       select project_id, $1, $2, $3, child_id from ids returning id
     ), model as (
       insert into models (id, project_id, name, position, latest_revision_id)
       select child_id, project_id, $2, 0, revision_id from ids
     ), revision as (
       insert into model_revisions (id, model_id, source_format, status, source_checksum, source_size_bytes)
       select revision_id, child_id, $4, 'uploaded', decode(repeat('00', 32), 'hex'), 0 from ids
     )
     select id from project`,
    [input.ownerId, input.title, input.description, input.sourceFormat],
  );
  const row = result.rows[0];
  if (row === undefined) throw new Error("model insert returned no row");
  return row.id;
}

export async function updateOwnedImportedModel(tx: ModelOwnerExecutor, input: { modelId: string; title: string; description: string | null; sourceFormat: string }): Promise<void> {
  await tx.query(
    `with project_update as (
       update projects set title = $2, description = $3, updated_at = now() where id = $1 returning id
     )
     update model_revisions revision set source_format = $4
      from models model
     where model.project_id = (select id from project_update) and revision.id = model.latest_revision_id`,
    [input.modelId, input.title, input.description, input.sourceFormat],
  );
}

export async function deleteOwnedModelFiles(modelId: string, roles: readonly string[], tx?: ModelOwnerExecutor): Promise<void> {
  if (roles.length === 0) return;
  await executor(tx).query(
    `delete from model_revision_files file using models model
      where model.project_id = $1 and file.model_revision_id = model.latest_revision_id and file.role = any($2::text[])`,
    [modelId, roles],
  );
}

export async function addOwnedModelFile(
  input: { modelId: string; role: string; s3Key: string | null; sizeBytes: number; checksum: Buffer; originalFilename?: string | null; mimeType?: string | null },
  tx?: ModelOwnerExecutor,
): Promise<void> {
  if (input.s3Key === null) throw new Error("model file requires an object key");
  await executor(tx).query(
    `with target as (
       select project.owner_id, model.latest_revision_id
         from projects project join models model on model.project_id = project.id
        where project.id = $1
     ), blob as (
       insert into storage_blobs (owner_id, checksum, size_bytes, s3_key, state)
       select owner_id, $5, $4, $3, 'ready' from target
       on conflict (owner_id, checksum, size_bytes) do update set state = 'ready', updated_at = now()
       returning id
     ), file as (
       insert into model_revision_files
         (model_revision_id, role, is_source, blob_id, original_filename, mime_type, size_bytes, checksum)
       select target.latest_revision_id, $2, $2 = 'source', blob.id, $6,
              coalesce($7, 'application/octet-stream'), $4, $5 from target cross join blob
     )
     update model_revisions revision
        set source_checksum = case when $2 = 'source' then $5 else revision.source_checksum end,
            source_size_bytes = case when $2 = 'source' then $4 else revision.source_size_bytes end
       from target where revision.id = target.latest_revision_id`,
    [input.modelId, input.role, input.s3Key, input.sizeBytes, input.checksum, input.originalFilename ?? null, input.mimeType ?? null],
  );
}

export async function syncOwnedModelTags(modelId: string, rawNames: readonly string[], tx?: ModelOwnerExecutor): Promise<void> {
  const names = [...new Set(rawNames.map((name) => name.trim().toLowerCase().slice(0, 40)).filter(Boolean))].slice(0, 8);
  const target = executor(tx);
  await target.query(`delete from model_tags where model_id = $1`, [modelId]);
  if (names.length === 0) return;
  const tagIds = await ensureOwnedTags(names, target);
  await target.query(`insert into model_tags (model_id, tag_id) select $1, unnest($2::uuid[]) on conflict do nothing`, [modelId, tagIds]);
}
