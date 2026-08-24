import { Inject, Injectable } from "@nestjs/common";
import type { Pool, PoolClient } from "pg";
import { DATABASE_POOL } from "../../../nest/database/database.constants.ts";
import type { UserId } from "../../_kernel/brandedIds.ts";
import type { ImportJobItemProgress, ImportJobProgress } from "../public/index.ts";

@Injectable()
export class ImportsRepository {
  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {}

  async enqueue(userId: UserId, connectionId: string, sourcePlatform: string, externalIds: readonly string[]) {
    return this.transaction(async (client) => {
      const job = await client.query<{ id: string }>(
        `insert into import_jobs (user_id, connection_id, source_platform, total_count)
         values ($1, $2, $3, $4) returning id`,
        [userId, connectionId, sourcePlatform, externalIds.length],
      );
      const jobId = job.rows[0]!.id;
      for (const externalId of externalIds) {
        await client.query(
          `insert into import_job_items (job_id, external_id) values ($1, $2)
           on conflict (job_id, external_id) do nothing`,
          [jobId, externalId],
        );
      }
      return jobId;
    });
  }

  async list(userId: UserId): Promise<readonly ImportJobProgress[]> {
    const result = await this.pool.query<ImportJobProgress>(
      `select id, source_platform, status, total_count, done_count, failed_count, created_at, started_at, finished_at
       from import_jobs where user_id = $1 order by created_at desc limit 50`,
      [userId],
    );
    return result.rows;
  }

  async find(userId: UserId, id: string): Promise<ImportJobProgress | null> {
    const result = await this.pool.query<ImportJobProgress>(
      `select id, source_platform, status, total_count, done_count, failed_count, created_at, started_at, finished_at
       from import_jobs where id = $1 and user_id = $2`,
      [id, userId],
    );
    return result.rows[0] ?? null;
  }

  async items(jobId: string): Promise<readonly ImportJobItemProgress[]> {
    const result = await this.pool.query<ImportJobItemProgress>(
      `select external_id, status, retryable, attempt_count, last_error
       from import_job_items where job_id = $1 order by created_at`,
      [jobId],
    );
    return result.rows;
  }

  private async transaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
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
}
