import { Inject, Injectable } from "@nestjs/common";
import type { Pool, QueryResultRow } from "pg";
import { DATABASE_POOL } from "../../../nest/database/database.constants.ts";
import type {
  AddModelFileInput,
  CreateGenerationDraftInput,
  CreateImportedModelInput,
  ModelOwnerPort,
  ModelQueryExecutor,
  OwnedDraftModel,
  UpdateImportedModelInput,
} from "../public/index.ts";

@Injectable()
export class ModelOwnerRepository implements ModelOwnerPort {
  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {}

  private query<R extends QueryResultRow>(text: string, values: readonly unknown[], executor?: ModelQueryExecutor) {
    return (executor ?? this.pool).query<R>(text, values);
  }

  async findGenerationDraft(sourceGenerationId: string, executor?: ModelQueryExecutor): Promise<OwnedDraftModel | null> {
    const result = await this.query<OwnedDraftModel>(
      `select p.id, p.title, revision.source_format, revision.status, revision.craft
         from model_revisions revision
         join models model on model.id = revision.model_id and model.latest_revision_id = revision.id
         join projects p on p.id = model.project_id
        where revision.source_generation_id = $1 and p.deleted_at is null`,
      [sourceGenerationId],
      executor,
    );
    return result.rows[0] ?? null;
  }

  async createGenerationDraft(executor: ModelQueryExecutor, input: CreateGenerationDraftInput): Promise<string> {
    const result = await this.query<{ id: string }>(
      `with ids as (
         select gen_random_uuid() as project_id, gen_random_uuid() as child_id, gen_random_uuid() as revision_id
       ), p as (
         insert into projects (id, owner_id, title, primary_model_id)
         select project_id, $1, $2, child_id from ids returning id
       ), m as (
         insert into models (id, project_id, name, position, latest_revision_id, active_revision_id)
         select child_id, project_id, $2, 0, revision_id, revision_id from ids
       ), r as (
         insert into model_revisions
           (id, model_id, source_format, status, craft, source_generation_id, source_checksum, source_size_bytes, ready_at)
         select revision_id, child_id, $3, 'ready', '3d_printing', $4,
                decode(repeat('00', 32), 'hex'), 0, now() from ids
       )
       select id from p`,
      [input.ownerId, input.title, input.sourceFormat, input.sourceGenerationId],
      executor,
    );
    const row = result.rows[0];
    if (!row) throw new Error("model insert returned no row");
    return row.id;
  }

  async createImportedModel(executor: ModelQueryExecutor, input: CreateImportedModelInput): Promise<string> {
    const result = await this.query<{ id: string }>(
      `with ids as (
         select gen_random_uuid() as project_id, gen_random_uuid() as child_id, gen_random_uuid() as revision_id
       ), p as (
         insert into projects (id, owner_id, title, description, primary_model_id)
         select project_id, $1, $2, $3, child_id from ids returning id
       ), m as (
         insert into models (id, project_id, name, position, latest_revision_id)
         select child_id, project_id, $2, 0, revision_id from ids
       ), r as (
         insert into model_revisions (id, model_id, source_format, status, source_checksum, source_size_bytes)
         select revision_id, child_id, $4, 'uploaded', decode(repeat('00', 32), 'hex'), 0 from ids
       )
       select id from p`,
      [input.ownerId, input.title, input.description, input.sourceFormat],
      executor,
    );
    const row = result.rows[0];
    if (!row) throw new Error("model insert returned no row");
    return row.id;
  }

  async updateImportedModel(executor: ModelQueryExecutor, input: UpdateImportedModelInput): Promise<void> {
    await this.query(
      `with pu as (
         update projects set title = $2, description = $3, updated_at = now() where id = $1 returning id
       )
       update model_revisions revision set source_format = $4
        from models model
       where model.project_id = (select id from pu)
         and revision.id = model.latest_revision_id`,
      [input.modelId, input.title, input.description, input.sourceFormat],
      executor,
    );
  }

  async deleteModelFiles(modelId: string, roles: readonly string[], executor?: ModelQueryExecutor): Promise<void> {
    if (roles.length === 0) return;
    await this.query(
      `delete from model_revision_files file
        using models model
        where model.project_id = $1
          and file.model_revision_id = model.latest_revision_id
          and file.role = any($2::text[])`,
      [modelId, roles],
      executor,
    );
  }

  async addModelFile(input: AddModelFileInput, executor?: ModelQueryExecutor): Promise<void> {
    if (input.s3Key === null) throw new Error("model file requires an object key");
    await this.query(
      `with target as (
         select project.owner_id, model.latest_revision_id
           from projects project join models model on model.project_id = project.id
          where project.id = $1
       ), blob as (
         insert into storage_blobs (owner_id, checksum, size_bytes, s3_key, state)
         select owner_id, $5, $4, $3, 'ready' from target
         on conflict (owner_id, checksum, size_bytes) do update
           set s3_key = excluded.s3_key, state = 'ready', updated_at = now()
         returning id
       ), file as (
         insert into model_revision_files
           (model_revision_id, role, is_source, blob_id, original_filename, mime_type, size_bytes, checksum)
         select target.latest_revision_id, $2, $2 = 'source', blob.id, $6,
                coalesce($7, 'application/octet-stream'), $4, $5
           from target cross join blob
       )
       update model_revisions revision
          set source_checksum = case when $2 = 'source' then $5 else revision.source_checksum end,
              source_size_bytes = case when $2 = 'source' then $4 else revision.source_size_bytes end
        from target
       where revision.id = target.latest_revision_id`,
      [input.modelId, input.role, input.s3Key, input.sizeBytes, input.checksum, input.originalFilename ?? null, input.mimeType ?? null],
      executor,
    );
  }

  async deleteModel(modelId: string, executor?: ModelQueryExecutor): Promise<void> {
    // modelId is the Project id; the child Model + its files/revisions cascade via FK on delete.
    await this.query(`delete from projects where id = $1`, [modelId], executor);
  }

  async replaceModelTags(modelId: string, tagIds: readonly string[], executor?: ModelQueryExecutor): Promise<void> {
    await this.clearModelTags(modelId, executor);
    await this.addModelTags(modelId, tagIds, executor);
  }

  async clearModelTags(modelId: string, executor?: ModelQueryExecutor): Promise<void> {
    await this.query(`delete from model_tags where model_id = $1`, [modelId], executor);
  }

  async addModelTags(modelId: string, tagIds: readonly string[], executor?: ModelQueryExecutor): Promise<void> {
    if (tagIds.length === 0) return;
    await this.query(
      `insert into model_tags (model_id, tag_id)
       select $1, unnest($2::uuid[])
       on conflict do nothing`,
      [modelId, tagIds],
      executor,
    );
  }

  async setRepoPath(modelId: string, repoPath: string, executor?: ModelQueryExecutor): Promise<void> {
    // repo_path is project-level; modelId is the Project id.
    await this.query(`update projects set repo_path = $2 where id = $1`, [modelId, repoPath], executor);
  }
}
