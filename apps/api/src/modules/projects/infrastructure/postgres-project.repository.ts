import { Inject, Injectable } from "@nestjs/common";
import type { Pool, PoolClient, QueryResultRow } from "pg";
import { DATABASE_POOL } from "../../../nest/database/database.constants.ts";
import { ModelId, ModelRevisionId, ProjectId, ProjectRevisionId, type UserId } from "../../_kernel/brandedIds.ts";
import { ensureOwnedTags } from "../../community/public/index.ts";
import { normalizeTags, sha256Canonical, type ModelCreateInput, type ProjectMetadataInput, type ProjectPatchInput } from "../domain/project.ts";
import { modelNotFound, ProjectError, projectNotFound, revisionNotFound, versionConflict } from "../domain/project.errors.ts";
import type { ModelRevisionView, ModelView, MutationResult, ProjectRepository, ProjectView, PublishedProjectView, UploadedSource } from "../domain/project.repository.ts";

interface ProjectRow extends QueryResultRow {
  id: string;
  title: string;
  description: string | null;
  repo_url: string | null;
  primary_model_id: string | null;
  published_revision_id: string | null;
  version: string;
  created_at: Date;
  updated_at: Date;
  owner_id: string;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
  tags: string[];
  models_count: string;
}

interface ModelRow extends QueryResultRow {
  id: string;
  project_id: string;
  name: string;
  position: number;
  latest_revision_id: string;
  active_revision_id: string | null;
  latest_revision_status: string;
  version: string;
  created_at: Date;
  updated_at: Date;
}

interface RevisionRow extends QueryResultRow {
  id: string;
  model_id: string;
  status: string;
  source_format: ModelRevisionView["source_format"];
  craft: string;
  manufacturing_method: string | null;
  requires_ams: boolean;
  bbox: unknown;
  failure_code: string | null;
  source_size_bytes: string;
  source_checksum_sha256: string;
  has_preview: boolean;
  created_at: Date;
  processing_started_at: Date | null;
  ready_at: Date | null;
  failed_at: Date | null;
}

interface LockedProject extends QueryResultRow {
  id: string;
  owner_id: string;
  version: string;
  primary_model_id: string | null;
  published_revision_id: string | null;
}

const PROJECT_COLUMNS = `p.id, p.title, p.description, p.repo_url, p.primary_model_id, p.published_revision_id,
         p.version, p.created_at, p.updated_at, p.owner_id,
         u.username, u.display_name, u.avatar_url,
         coalesce((select array_agg(t.name order by t.name) from model_tags mt join tags t on t.id = mt.tag_id where mt.model_id = p.id), '{}') as tags,
         (select count(*) from models m where m.project_id = p.id and m.deleted_at is null) as models_count`;
const PROJECT_FROM = `from projects p join identity_read_v1 u on u.user_id = p.owner_id`;
const PROJECT_SELECT = `select ${PROJECT_COLUMNS} ${PROJECT_FROM}`;

const MODEL_COLUMNS = `m.id, m.project_id, m.name, m.position, m.latest_revision_id, m.active_revision_id,
         lr.status as latest_revision_status, m.version, m.created_at, m.updated_at`;
const MODEL_FROM = `from models m join model_revisions lr on lr.id = m.latest_revision_id and lr.model_id = m.id`;
const MODEL_SELECT = `select ${MODEL_COLUMNS} ${MODEL_FROM}`;

const REVISION_SELECT = `
  select r.id, r.model_id, r.status, r.source_format, r.craft, r.manufacturing_method,
         r.requires_ams, r.bbox, r.failure_code, r.source_size_bytes,
         encode(r.source_checksum, 'hex') as source_checksum_sha256,
         exists(select 1 from model_revision_files f where f.model_revision_id = r.id and f.role = 'preview') as has_preview,
         r.created_at, r.processing_started_at, r.ready_at, r.failed_at
    from model_revisions r`;

function projectView(row: ProjectRow, primaryModel?: ModelView | null): ProjectView {
  return {
    id: ProjectId(row.id),
    title: row.title,
    description: row.description,
    tags: row.tags,
    owner: { id: row.owner_id, username: row.username, display_name: row.display_name, avatar_url: row.avatar_url },
    primary_model_id: row.primary_model_id === null ? null : ModelId(row.primary_model_id),
    published_revision_id: row.published_revision_id === null ? null : ProjectRevisionId(row.published_revision_id),
    models_count: Number(row.models_count),
    version: Number(row.version),
    created_at: row.created_at,
    updated_at: row.updated_at,
    repo_url: row.repo_url,
    ...(primaryModel === undefined ? {} : { primary_model: primaryModel }),
  };
}

function modelView(row: ModelRow): ModelView {
  return {
    id: ModelId(row.id),
    project_id: ProjectId(row.project_id),
    name: row.name,
    position: row.position,
    latest_revision_id: ModelRevisionId(row.latest_revision_id),
    active_revision_id: row.active_revision_id === null ? null : ModelRevisionId(row.active_revision_id),
    latest_revision_status: row.latest_revision_status,
    version: Number(row.version),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function revisionView(row: RevisionRow, projectId: string): ModelRevisionView {
  const base = `/projects/${projectId}/models/${row.model_id}/revisions/${row.id}`;
  return {
    id: ModelRevisionId(row.id),
    model_id: ModelId(row.model_id),
    status: row.status,
    source_format: row.source_format,
    craft: row.craft,
    manufacturing_method: row.manufacturing_method,
    requires_ams: row.requires_ams,
    bbox: row.bbox,
    failure_code: row.status === "failed" ? row.failure_code : null,
    source_size_bytes: Number(row.source_size_bytes),
    source_checksum_sha256: row.source_checksum_sha256,
    source_url: `${base}/source`,
    preview_url: row.has_preview ? `${base}/preview.glb` : null,
    created_at: row.created_at,
    processing_started_at: row.processing_started_at,
    ready_at: row.ready_at,
    failed_at: row.failed_at,
  };
}

@Injectable()
export class PostgresProjectRepository implements ProjectRepository {
  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {}

  private async transaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      await client.query("set constraints all deferred");
      const result = await work(client);
      await client.query("commit");
      return result;
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  private async lockProject(client: PoolClient, actorId: UserId, projectId: ProjectId, version?: number): Promise<LockedProject> {
    const result = await client.query<LockedProject>(
      `select id, owner_id, version, primary_model_id, published_revision_id
         from projects where id = $1 and owner_id = $2 and deleted_at is null for update`,
      [projectId, actorId],
    );
    const row = result.rows[0];
    if (row === undefined) throw projectNotFound();
    if (version !== undefined && Number(row.version) !== version) throw versionConflict();
    return row;
  }

  private async loadDraft(db: Pool | PoolClient, actorId: UserId, projectId: ProjectId): Promise<ProjectView | null> {
    const result = await db.query<ProjectRow>(`${PROJECT_SELECT} where p.id = $1 and p.owner_id = $2 and p.deleted_at is null`, [projectId, actorId]);
    const row = result.rows[0];
    if (row === undefined) return null;
    let primary: ModelView | null = null;
    if (row.primary_model_id !== null) {
      const model = await db.query<ModelRow>(`${MODEL_SELECT} where m.id = $1 and m.project_id = $2 and m.deleted_at is null`, [row.primary_model_id, projectId]);
      primary = model.rows[0] === undefined ? null : modelView(model.rows[0]);
    }
    return projectView(row, primary);
  }

  private async replaceTags(client: PoolClient, projectId: ProjectId, tags: readonly string[]): Promise<void> {
    await client.query("delete from model_tags where model_id = $1", [projectId]);
    if (tags.length === 0) return;
    const tagIds = await ensureOwnedTags(tags, client);
    await client.query(`insert into model_tags(model_id, tag_id) select $1, unnest($2::uuid[])`, [projectId, tagIds]);
  }

  private async claimIdempotency<T>(client: PoolClient, actorId: UserId, scope: string, key: string, fingerprint: Buffer): Promise<T | null> {
    const inserted = await client.query(
      `insert into idempotency_records
         (actor_id, operation_scope, idempotency_key, request_fingerprint, lease_expires_at, expires_at)
       values ($1, $2, $3, $4, now() + interval '15 minutes', now() + interval '7 days')
       on conflict do nothing`,
      [actorId, scope, key, fingerprint],
    );
    if ((inserted.rowCount ?? 0) === 1) return null;
    const result = await client.query<{ request_fingerprint: Buffer; state: string; lease_expires_at: Date; response_body: T | null }>(
      `select request_fingerprint, state, lease_expires_at, response_body
         from idempotency_records
        where actor_id = $1 and operation_scope = $2 and idempotency_key = $3 for update`,
      [actorId, scope, key],
    );
    const row = result.rows[0];
    if (row === undefined) throw new Error("idempotency record disappeared");
    if (!row.request_fingerprint.equals(fingerprint)) {
      throw new ProjectError(409, "project.idempotency_conflict.v1", "Idempotency-Key использован с другим запросом");
    }
    if (row.state === "completed" && row.response_body !== null) return row.response_body;
    if (row.lease_expires_at.getTime() > Date.now()) {
      throw new ProjectError(409, "project.request_in_progress.v1", "Запрос ещё выполняется", { "Retry-After": "2" });
    }
    await client.query(
      `update idempotency_records set lease_expires_at = now() + interval '15 minutes', updated_at = now()
        where actor_id = $1 and operation_scope = $2 and idempotency_key = $3`,
      [actorId, scope, key],
    );
    return null;
  }

  private async completeIdempotency(
    client: PoolClient,
    actorId: UserId,
    scope: string,
    key: string,
    value: unknown,
    resourceId: string,
    version: number,
    location: string,
  ): Promise<void> {
    await client.query(
      `update idempotency_records
          set state = 'completed', response_status = 201, response_body = $4,
              response_headers = $5, resource_id = $6, updated_at = now()
        where actor_id = $1 and operation_scope = $2 and idempotency_key = $3`,
      [actorId, scope, key, value, { Location: location, ETag: `"${version}"` }, resourceId],
    );
  }

  async createProject(actorId: UserId, input: ProjectMetadataInput, key: string, fingerprint: Buffer): Promise<MutationResult<ProjectView>> {
    return this.transaction(async (client) => {
      const replay = await this.claimIdempotency<ProjectView>(client, actorId, "projectsCreate", key, fingerprint);
      if (replay !== null) return { value: replay, version: replay.version, replayed: true };
      const inserted = await client.query<{ id: string }>(`insert into projects(owner_id, title, description, repo_url) values ($1, $2, $3, $4) returning id`, [
        actorId,
        input.title,
        input.description ?? null,
        input.repo_url ?? null,
      ]);
      const projectId = ProjectId(inserted.rows[0]!.id);
      await this.replaceTags(client, projectId, normalizeTags(input.tags));
      const value = await this.loadDraft(client, actorId, projectId);
      if (value === null) throw new Error("created project disappeared");
      await this.completeIdempotency(client, actorId, "projectsCreate", key, value, projectId, value.version, `/projects/${projectId}/draft`);
      return { value, version: value.version };
    });
  }

  async listPublished(limit: number, cursor: readonly unknown[] | null): Promise<readonly ProjectView[]> {
    const values: unknown[] = [limit + 1];
    let cursorSql = "";
    if (cursor !== null) {
      values.push(cursor[0], cursor[1]);
      cursorSql = `and (pr.created_at, p.id) < ($2::timestamptz, $3::uuid)`;
    }
    const result = await this.pool.query<ProjectRow & { published_at: Date; snapshot: { title: string; description: string | null; tags: string[] } }>(
      `select ${PROJECT_COLUMNS}, pr.created_at as published_at, pr.metadata_snapshot as snapshot
         ${PROJECT_FROM} join project_revisions pr on pr.id = p.published_revision_id and pr.project_id = p.id
        where p.deleted_at is null ${cursorSql}
        order by pr.created_at desc, p.id desc limit $1`,
      values,
    );
    return result.rows.map((row) =>
      projectView({ ...row, title: row.snapshot.title, description: row.snapshot.description, tags: row.snapshot.tags, updated_at: row.published_at }),
    );
  }

  async listOwned(actorId: UserId, limit: number, cursor: readonly unknown[] | null): Promise<readonly ProjectView[]> {
    const values: unknown[] = [actorId, limit + 1];
    let cursorSql = "";
    if (cursor !== null) {
      values.push(cursor[0], cursor[1]);
      cursorSql = `and (p.updated_at, p.id) < ($3::timestamptz, $4::uuid)`;
    }
    const result = await this.pool.query<ProjectRow>(
      `${PROJECT_SELECT} where p.owner_id = $1 and p.deleted_at is null ${cursorSql}
        order by p.updated_at desc, p.id desc limit $2`,
      values,
    );
    return result.rows.map((row) => projectView(row));
  }

  async getPublished(projectId: ProjectId): Promise<PublishedProjectView | null> {
    const result = await this.pool.query<
      ProjectRow & { project_revision_id: string; published_at: Date; snapshot: { title: string; description: string | null; tags: string[]; repo_url: string | null } }
    >(
      `select ${PROJECT_COLUMNS}, pr.id as project_revision_id, pr.created_at as published_at, pr.metadata_snapshot as snapshot
         ${PROJECT_FROM} join project_revisions pr on pr.id = p.published_revision_id and pr.project_id = p.id
        where p.id = $1 and p.deleted_at is null`,
      [projectId],
    );
    const row = result.rows[0];
    if (row === undefined) return null;
    const models = await this.pool.query<ModelRow>(
      `select m.id, m.project_id, m.name, prm.position,
              prm.model_revision_id as latest_revision_id, prm.model_revision_id as active_revision_id,
              pinned.status as latest_revision_status, m.version, m.created_at, m.updated_at
         from project_revision_models prm
         join models m on m.id = prm.model_id and m.project_id = prm.project_id
         join model_revisions pinned on pinned.id = prm.model_revision_id and pinned.model_id = m.id
        where prm.project_revision_id = $1 order by prm.position, m.id`,
      [row.project_revision_id],
    );
    const base = projectView({ ...row, title: row.snapshot.title, description: row.snapshot.description, tags: row.snapshot.tags, repo_url: row.snapshot.repo_url });
    return { ...base, project_revision_id: ProjectRevisionId(row.project_revision_id), published_at: row.published_at, published_models: models.rows.map(modelView) };
  }

  getDraft(actorId: UserId, projectId: ProjectId): Promise<ProjectView | null> {
    return this.loadDraft(this.pool, actorId, projectId);
  }

  async updateProject(actorId: UserId, projectId: ProjectId, version: number, patch: ProjectPatchInput): Promise<MutationResult<ProjectView>> {
    return this.transaction(async (client) => {
      await this.lockProject(client, actorId, projectId, version);
      await client.query(
        `update projects set
           title = case when $2::boolean then $3 else title end,
           description = case when $4::boolean then $5 else description end,
           repo_url = case when $6::boolean then $7 else repo_url end,
           version = version + 1, updated_at = now()
         where id = $1`,
        [
          projectId,
          patch.title !== undefined,
          patch.title ?? null,
          patch.description !== undefined,
          patch.description ?? null,
          patch.repo_url !== undefined,
          patch.repo_url ?? null,
        ],
      );
      if (patch.tags !== undefined) await this.replaceTags(client, projectId, normalizeTags(patch.tags));
      const value = await this.loadDraft(client, actorId, projectId);
      if (value === null) throw projectNotFound();
      return { value, version: value.version };
    });
  }

  async deleteProject(actorId: UserId, projectId: ProjectId, version: number): Promise<void> {
    await this.transaction(async (client) => {
      await this.lockProject(client, actorId, projectId, version);
      await client.query("update projects set deleted_at = now(), deleted_by = $2, version = version + 1, updated_at = now() where id = $1", [projectId, actorId]);
      await client.query("update models set deleted_at = now(), version = version + 1, updated_at = now() where project_id = $1 and deleted_at is null", [projectId]);
    });
  }

  private async persistSource(client: PoolClient, actorId: UserId, revisionId: string, source: UploadedSource): Promise<void> {
    await client.query(
      `insert into storage_blobs(owner_id, checksum, size_bytes, s3_key, state)
       values ($1, $2, $3, $4, 'ready') on conflict (owner_id, checksum, size_bytes)
       do update set state = 'ready', updated_at = now()`,
      [actorId, source.checksum, source.sizeBytes, source.objectKey],
    );
    await client.query(
      `insert into model_revision_files(model_revision_id, role, is_source, blob_id, original_filename, mime_type, size_bytes, checksum)
       select $1, $2, true, id, $5, $6, $3, $4 from storage_blobs
        where owner_id = $7 and checksum = $4 and size_bytes = $3`,
      [revisionId, source.role, source.sizeBytes, source.checksum, source.filename, source.mimeType, actorId],
    );
  }

  private async enqueueRevision(client: PoolClient, projectId: ProjectId, modelId: string, revisionId: string): Promise<void> {
    await client.query(
      `insert into outbox_events(aggregate_type, aggregate_id, event_type, event_version, payload)
       values ('ModelRevision', $1::uuid, 'model.revision.uploaded.v1', 1,
               jsonb_build_object('project_id', $2::uuid, 'model_id', $3::uuid, 'revision_id', $1::uuid))`,
      [revisionId, projectId, modelId],
    );
  }

  async createModel(
    actorId: UserId,
    projectId: ProjectId,
    version: number,
    input: ModelCreateInput,
    source: UploadedSource,
    key: string,
    fingerprint: Buffer,
  ): Promise<MutationResult<ModelView>> {
    return this.transaction(async (client) => {
      await this.lockProject(client, actorId, projectId, version);
      const scope = `projectModelsCreate:${projectId}`;
      const replay = await this.claimIdempotency<ModelView>(client, actorId, scope, key, fingerprint);
      if (replay !== null) return { value: replay, version, replayed: true };
      const position = await client.query<{ value: number }>("select coalesce(max(position), -1) + 1 as value from models where project_id = $1", [projectId]);
      const ids = await client.query<{ model_id: string; revision_id: string }>("select gen_random_uuid() as model_id, gen_random_uuid() as revision_id");
      const { model_id: modelId, revision_id: revisionId } = ids.rows[0]!;
      await client.query(
        `insert into models(id, project_id, name, position, latest_revision_id)
         values ($1, $2, $3, $4, $5)`,
        [modelId, projectId, input.name, position.rows[0]!.value, revisionId],
      );
      await client.query(
        `insert into model_revisions
           (id, model_id, status, source_format, craft, manufacturing_method, requires_ams, source_checksum, source_size_bytes)
         values ($1, $2, 'uploaded', $3, $4, $5, $6, $7, $8)`,
        [revisionId, modelId, source.sourceFormat, source.craft, input.manufacturing_method ?? null, input.requires_ams ?? false, source.checksum, source.sizeBytes],
      );
      await this.persistSource(client, actorId, revisionId, source);
      await this.enqueueRevision(client, projectId, modelId, revisionId);
      await client.query(`update projects set primary_model_id = coalesce(primary_model_id, $2), version = version + 1, updated_at = now() where id = $1`, [projectId, modelId]);
      const result = await client.query<ModelRow>(`${MODEL_SELECT} where m.id = $1 and m.project_id = $2`, [modelId, projectId]);
      const value = modelView(result.rows[0]!);
      await this.completeIdempotency(client, actorId, scope, key, value, modelId, version + 1, `/projects/${projectId}/models/${modelId}`);
      return { value, version: version + 1 };
    });
  }

  async listModels(actorId: UserId, projectId: ProjectId, limit: number, cursor: readonly unknown[] | null): Promise<readonly ModelView[] | null> {
    if ((await this.getDraft(actorId, projectId)) === null) return null;
    const values: unknown[] = [projectId, limit + 1];
    let cursorSql = "";
    if (cursor !== null) {
      values.push(cursor[0], cursor[1]);
      cursorSql = "and (m.position, m.id) > ($3::integer, $4::uuid)";
    }
    const result = await this.pool.query<ModelRow>(`${MODEL_SELECT} where m.project_id = $1 and m.deleted_at is null ${cursorSql} order by m.position, m.id limit $2`, values);
    return result.rows.map(modelView);
  }

  async getModel(actorId: UserId, projectId: ProjectId, modelId: ModelId): Promise<ModelView | null> {
    if ((await this.getDraft(actorId, projectId)) === null) return null;
    const result = await this.pool.query<ModelRow>(`${MODEL_SELECT} where m.project_id = $1 and m.id = $2 and m.deleted_at is null`, [projectId, modelId]);
    return result.rows[0] === undefined ? null : modelView(result.rows[0]);
  }

  async deleteModel(actorId: UserId, projectId: ProjectId, modelId: ModelId, version: number): Promise<number> {
    return this.transaction(async (client) => {
      const project = await this.lockProject(client, actorId, projectId, version);
      const model = await client.query("select id from models where id = $1 and project_id = $2 and deleted_at is null for update", [modelId, projectId]);
      if ((model.rowCount ?? 0) === 0) throw modelNotFound();
      const pinned = await client.query(`select 1 from project_revision_models where project_id = $1 and project_revision_id = $2 and model_id = $3`, [
        projectId,
        project.published_revision_id,
        modelId,
      ]);
      if ((pinned.rowCount ?? 0) > 0) throw new ProjectError(409, "project.model_published.v1", "Модель используется текущей публикацией");
      await client.query("update models set deleted_at = now(), version = version + 1, updated_at = now() where id = $1", [modelId]);
      await client.query(
        "update projects set primary_model_id = case when primary_model_id = $2 then null else primary_model_id end, version = version + 1, updated_at = now() where id = $1",
        [projectId, modelId],
      );
      return version + 1;
    });
  }

  async createRevision(
    actorId: UserId,
    projectId: ProjectId,
    modelId: ModelId,
    version: number,
    source: UploadedSource,
    key: string,
    fingerprint: Buffer,
  ): Promise<MutationResult<ModelRevisionView>> {
    return this.transaction(async (client) => {
      await this.lockProject(client, actorId, projectId, version);
      const model = await client.query("select id from models where id = $1 and project_id = $2 and deleted_at is null for update", [modelId, projectId]);
      if ((model.rowCount ?? 0) === 0) throw modelNotFound();
      const scope = `projectModelRevisionsCreate:${projectId}:${modelId}`;
      const replay = await this.claimIdempotency<ModelRevisionView>(client, actorId, scope, key, fingerprint);
      if (replay !== null) return { value: replay, version, replayed: true };
      const revision = await client.query<{ id: string }>(
        `insert into model_revisions(model_id, status, source_format, craft, source_checksum, source_size_bytes)
         values ($1, 'uploaded', $2, $3, $4, $5) returning id`,
        [modelId, source.sourceFormat, source.craft, source.checksum, source.sizeBytes],
      );
      const revisionId = revision.rows[0]!.id;
      await this.persistSource(client, actorId, revisionId, source);
      await this.enqueueRevision(client, projectId, modelId, revisionId);
      await client.query("update models set latest_revision_id = $2, version = version + 1, updated_at = now() where id = $1", [modelId, revisionId]);
      await client.query("update projects set version = version + 1, updated_at = now() where id = $1", [projectId]);
      const result = await client.query<RevisionRow>(`${REVISION_SELECT} where r.id = $1 and r.model_id = $2`, [revisionId, modelId]);
      const value = revisionView(result.rows[0]!, projectId);
      await this.completeIdempotency(client, actorId, scope, key, value, revisionId, version + 1, `/projects/${projectId}/models/${modelId}/revisions/${revisionId}`);
      return { value, version: version + 1 };
    });
  }

  async listRevisions(actorId: UserId, projectId: ProjectId, modelId: ModelId, limit: number, cursor: readonly unknown[] | null): Promise<readonly ModelRevisionView[] | null> {
    if ((await this.getModel(actorId, projectId, modelId)) === null) return null;
    const values: unknown[] = [modelId, limit + 1];
    let cursorSql = "";
    if (cursor !== null) {
      values.push(cursor[0], cursor[1]);
      cursorSql = "and (r.created_at, r.id) < ($3::timestamptz, $4::uuid)";
    }
    const result = await this.pool.query<RevisionRow>(`${REVISION_SELECT} where r.model_id = $1 ${cursorSql} order by r.created_at desc, r.id desc limit $2`, values);
    return result.rows.map((row) => revisionView(row, projectId));
  }

  async getRevision(actorId: UserId, projectId: ProjectId, modelId: ModelId, revisionId: ModelRevisionId): Promise<ModelRevisionView | null> {
    if ((await this.getModel(actorId, projectId, modelId)) === null) return null;
    const result = await this.pool.query<RevisionRow>(`${REVISION_SELECT} where r.id = $1 and r.model_id = $2`, [revisionId, modelId]);
    return result.rows[0] === undefined ? null : revisionView(result.rows[0], projectId);
  }

  async revisionAsset(actorId: UserId | null, projectId: ProjectId, modelId: ModelId, revisionId: ModelRevisionId, role: "source" | "preview"): Promise<string | null> {
    const result = await this.pool.query<{ s3_key: string }>(
      `select b.s3_key
         from projects p
         join models m on m.project_id = p.id and m.id = $2 and m.deleted_at is null
         join model_revisions r on r.model_id = m.id and r.id = $3
         join model_revision_files f on f.model_revision_id = r.id and (($4 = 'source' and f.is_source) or ($4 = 'preview' and f.role = 'preview'))
         join storage_blobs b on b.id = f.blob_id and b.state = 'ready'
        where p.id = $1 and p.deleted_at is null
          and (($4 = 'source' and p.owner_id = $5)
            or ($4 = 'preview' and (p.owner_id = $5 or exists(
              select 1 from project_revision_models prm
               where prm.project_id = p.id and prm.project_revision_id = p.published_revision_id
                 and prm.model_id = m.id and prm.model_revision_id = r.id))))`,
      [projectId, modelId, revisionId, role, actorId],
    );
    return result.rows[0]?.s3_key ?? null;
  }

  async setPrimary(actorId: UserId, projectId: ProjectId, modelId: ModelId, version: number): Promise<MutationResult<ProjectView>> {
    return this.transaction(async (client) => {
      await this.lockProject(client, actorId, projectId, version);
      const model = await client.query<{ status: string | null }>(
        `select r.status from models m left join model_revisions r on r.id = m.active_revision_id
          where m.id = $1 and m.project_id = $2 and m.deleted_at is null for update of m`,
        [modelId, projectId],
      );
      const row = model.rows[0];
      if (row === undefined) throw modelNotFound();
      const published = await client.query("select 1 from projects where id = $1 and published_revision_id is not null", [projectId]);
      if ((published.rowCount ?? 0) > 0 && row.status !== "ready") {
        throw new ProjectError(409, "project.ready_primary_required.v1", "Для опубликованного проекта нужна готовая primary Model");
      }
      await client.query("update projects set primary_model_id = $2, version = version + 1, updated_at = now() where id = $1", [projectId, modelId]);
      const value = await this.loadDraft(client, actorId, projectId);
      if (value === null) throw projectNotFound();
      return { value, version: value.version };
    });
  }

  async clearPrimary(actorId: UserId, projectId: ProjectId, version: number): Promise<number> {
    return this.transaction(async (client) => {
      const project = await this.lockProject(client, actorId, projectId, version);
      if (project.published_revision_id !== null) {
        throw new ProjectError(409, "project.primary_model_published.v1", "Сначала снимите проект с публикации");
      }
      await client.query("update projects set primary_model_id = null, version = version + 1, updated_at = now() where id = $1", [projectId]);
      return version + 1;
    });
  }

  async publish(
    actorId: UserId,
    projectId: ProjectId,
    version: number,
  ): Promise<MutationResult<{ project_revision_id: ProjectRevisionId; project_id: ProjectId; version: number; published_at: Date }>> {
    return this.transaction(async (client) => {
      const project = await this.lockProject(client, actorId, projectId, version);
      if (project.primary_model_id === null) {
        throw new ProjectError(409, "project.primary_model_required.v1", "Выберите primary Model");
      }
      const draft = await this.loadDraft(client, actorId, projectId);
      if (draft === null) throw projectNotFound();
      const models = await client.query<ModelRow & { active_status: string | null; has_source: boolean }>(
        `select ${MODEL_COLUMNS}, ar.status as active_status,
                exists(select 1 from model_revision_files f join storage_blobs b on b.id = f.blob_id and b.state = 'ready'
                        where f.model_revision_id = m.active_revision_id and f.is_source) as has_source
           ${MODEL_FROM} left join model_revisions ar on ar.id = m.active_revision_id and ar.model_id = m.id
          where m.project_id = $1 and m.deleted_at is null order by m.position, m.id for update of m`,
        [projectId],
      );
      const primary = models.rows.find((row) => row.id === project.primary_model_id);
      if (primary?.active_revision_id === null || primary?.active_status !== "ready" || !primary.has_source) {
        throw new ProjectError(409, "project.ready_primary_required.v1", "Primary Model не имеет готовой active revision");
      }
      const ready = models.rows.filter((row) => row.active_revision_id !== null && row.active_status === "ready" && row.has_source);
      const activeIds = ready
        .map((row) => row.active_revision_id)
        .filter((value): value is string => value !== null)
        .sort();
      if (activeIds.length > 0) await client.query("select id from model_revisions where id = any($1::uuid[]) order by id for update", [activeIds]);
      const metadata = {
        schema: "project-publication.v1",
        title: draft.title,
        description: draft.description,
        tags: [...draft.tags],
        repo_url: draft.repo_url ?? null,
        owner_id: draft.owner.id,
      };
      const snapshot = {
        metadata,
        models: ready.map((row) => ({ model_id: row.id, model_revision_id: row.active_revision_id, position: row.position })),
      };
      const hash = sha256Canonical(snapshot);
      const revision = await client.query<{ id: string; created_at: Date }>(
        `with inserted as (
           insert into project_revisions(project_id, content_hash, primary_model_id, metadata_snapshot)
           values ($1, $2, $3, $4) on conflict (project_id, content_hash) do nothing
           returning id, created_at
         )
         select id, created_at from inserted
         union all
         select id, created_at from project_revisions where project_id = $1 and content_hash = $2
         limit 1`,
        [projectId, hash, project.primary_model_id, metadata],
      );
      const publication = revision.rows[0]!;
      for (const row of ready) {
        await client.query(
          `insert into project_revision_models(project_revision_id, project_id, model_id, model_revision_id, position)
           values ($1, $2, $3, $4, $5) on conflict (project_revision_id, model_id) do nothing`,
          [publication.id, projectId, row.id, row.active_revision_id, row.position],
        );
      }
      const changed = project.published_revision_id !== publication.id;
      if (changed) {
        await client.query("update projects set published_revision_id = $2, version = version + 1, updated_at = now() where id = $1", [projectId, publication.id]);
      }
      const resultingVersion = changed ? version + 1 : version;
      return {
        value: { project_revision_id: ProjectRevisionId(publication.id), project_id: projectId, version: resultingVersion, published_at: publication.created_at },
        version: resultingVersion,
      };
    });
  }

  async unpublish(actorId: UserId, projectId: ProjectId, version: number): Promise<number> {
    return this.transaction(async (client) => {
      const project = await this.lockProject(client, actorId, projectId, version);
      if (project.published_revision_id === null) return version;
      await client.query("update projects set published_revision_id = null, version = version + 1, updated_at = now() where id = $1", [projectId]);
      return version + 1;
    });
  }

  async transitionRevision(revisionId: ModelRevisionId, from: string, to: string, failure?: { code: string; detailSafe?: string }): Promise<boolean> {
    return this.transaction(async (client) => {
      const located = await client.query<{ project_id: string; model_id: string }>(
        `select m.project_id, r.model_id from model_revisions r join models m on m.id = r.model_id where r.id = $1`,
        [revisionId],
      );
      const row = located.rows[0];
      if (row === undefined) throw revisionNotFound();
      await client.query("select id from projects where id = $1 for update", [row.project_id]);
      await client.query("select id from models where id = $1 for update", [row.model_id]);
      const changed = await client.query(
        `update model_revisions set status = $3,
           processing_started_at = case when $3 = 'processing' then now() else processing_started_at end,
           ready_at = case when $3 = 'ready' then now() else ready_at end,
           failed_at = case when $3 = 'failed' then now() else failed_at end,
           failure_code = case when $3 = 'failed' then $4 else failure_code end,
           failure_detail_safe = case when $3 = 'failed' then $5 else failure_detail_safe end
         where id = $1 and status = $2`,
        [revisionId, from, to, failure?.code ?? null, failure?.detailSafe ?? null],
      );
      if ((changed.rowCount ?? 0) === 0) return false;
      if (to === "ready") {
        await client.query("update models set active_revision_id = $2, version = version + 1, updated_at = now() where id = $1", [row.model_id, revisionId]);
        await client.query("update projects set version = version + 1, updated_at = now() where id = $1", [row.project_id]);
      } else if (to === "failed") {
        await client.query("update models set version = version + 1, updated_at = now() where id = $1", [row.model_id]);
        await client.query("update projects set version = version + 1, updated_at = now() where id = $1", [row.project_id]);
      }
      return true;
    });
  }
}
