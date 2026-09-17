import { Inject, Injectable } from "@nestjs/common";
import type { Pool } from "pg";
import { DATABASE_POOL } from "../../../nest/database/database.constants.ts";
import { ModelId } from "../../_kernel/brandedIds.ts";
import { enqueueModelIndexJob } from "./indexQueue.ts";
import type { MissingPublishedModelIndex, ModelIndexDocument, ModelIndexPort } from "../public/model-index.ts";

@Injectable()
export class ModelIndexRepository implements ModelIndexPort {
  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {}

  async enqueue(modelId: string, document: ModelIndexDocument): Promise<void> {
    await enqueueModelIndexJob(modelId, { title: document.title, description: document.description, tags: [...document.tags] });
  }

  async markQueuedForProjectUnpublished(projectId: string): Promise<void> {
    await this.pool.query(
      `update search_index_jobs set status = 'failed', last_error = 'project unpublished', updated_at = now()
        where model_id in (select id from models where project_id = $1) and status = 'queued'`,
      [projectId],
    );
  }

  async missingPublished(limit: number): Promise<readonly MissingPublishedModelIndex[]> {
    const result = await this.pool.query<{ model_id: string; title: string; description: string | null; tags: string[] }>(
      `select prm.model_id,
              pr.metadata_snapshot ->> 'title' as title,
              pr.metadata_snapshot ->> 'description' as description,
              coalesce(array(select jsonb_array_elements_text(coalesce(pr.metadata_snapshot -> 'tags', '[]'::jsonb))), array[]::text[]) as tags
         from projects p
         join project_revisions pr on pr.id = p.published_revision_id
         join project_revision_models prm on prm.project_revision_id = pr.id
        where p.published_revision_id is not null
          and not exists (
            select 1 from search_index_jobs sij
             where sij.model_id = prm.model_id and sij.status in ('queued', 'running', 'done')
          )
        limit $1`,
      [limit],
    );
    return result.rows.map((row) => ({ modelId: ModelId(row.model_id), document: { title: row.title, description: row.description, tags: row.tags } }));
  }
}
