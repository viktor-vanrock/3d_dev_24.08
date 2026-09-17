import { Inject, Injectable } from "@nestjs/common";
import type { Pool, QueryResultRow } from "pg";
import { DATABASE_POOL } from "../../../nest/database/database.constants.ts";
import type { FileRole, UploadStatus } from "../domain/upload.ts";

export interface UploadSessionRow extends QueryResultRow {
  id: string;
  owner_id: string;
  role: FileRole;
  status: UploadStatus;
  object_key: string | null;
  final_key: string | null;
  original_name: string | null;
  mime_type: string | null;
  size_bytes: string | null;
  checksum_sha256: Buffer | null;
  error_code: string | null;
  error_message: string | null;
  expires_at: Date;
  created_at: Date;
}

@Injectable()
export class UploadSessionRepository {
  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {}

  async create(params: { readonly id: string; readonly ownerId: string; readonly role: FileRole; readonly objectKey: string; readonly expiresAt: Date }): Promise<UploadSessionRow> {
    const result = await this.pool.query<UploadSessionRow>(
      `insert into upload_sessions (id, owner_id, role, status, object_key, expires_at)
       values ($1, $2, $3, 'pending', $4, $5) returning *`,
      [params.id, params.ownerId, params.role, params.objectKey, params.expiresAt],
    );
    return result.rows[0]!;
  }

  async markValidating(id: string, ownerId: string): Promise<boolean> {
    const result = await this.pool.query(
      `update upload_sessions set status = 'validating', updated_at = now()
       where id = $1 and owner_id = $2 and status = 'pending'`,
      [id, ownerId],
    );
    return result.rowCount === 1;
  }

  async markReady(params: { readonly id: string; readonly ownerId: string; readonly finalKey: string; readonly mimeType: string; readonly sizeBytes: number; readonly checksum: Buffer; readonly name: string }): Promise<UploadSessionRow | null> {
    const result = await this.pool.query<UploadSessionRow>(
      `update upload_sessions
          set status = 'ready', final_key = $3, mime_type = $4, size_bytes = $5,
              checksum_sha256 = $6, original_name = $7, object_key = null, updated_at = now()
        where id = $1 and owner_id = $2 and status in ('pending', 'validating')
        returning *`,
      [params.id, params.ownerId, params.finalKey, params.mimeType, params.sizeBytes, params.checksum, params.name],
    );
    return result.rows[0] ?? null;
  }

  async markFailed(params: { readonly id: string; readonly ownerId: string; readonly errorCode: string; readonly errorMessage: string }): Promise<void> {
    await this.pool.query(
      `update upload_sessions set status = 'failed', error_code = $3, error_message = $4, updated_at = now()
       where id = $1 and owner_id = $2`,
      [params.id, params.ownerId, params.errorCode, params.errorMessage],
    );
  }

  async findReadyOwned(id: string, ownerId: string): Promise<UploadSessionRow | null> {
    const result = await this.pool.query<UploadSessionRow>(
      `select * from upload_sessions
        where id = $1 and owner_id = $2 and status = 'ready' and expires_at > now()`,
      [id, ownerId],
    );
    return result.rows[0] ?? null;
  }

  async findExpired(limit = 50): Promise<UploadSessionRow[]> {
    const result = await this.pool.query<UploadSessionRow>(
      `select * from upload_sessions
        where expires_at < now() and status in ('pending', 'validating', 'failed')
        order by expires_at limit $1`,
      [limit],
    );
    return result.rows;
  }

  async markAbandoned(id: string): Promise<void> {
    await this.pool.query(`update upload_sessions set status = 'abandoned', updated_at = now() where id = $1`, [id]);
  }
}
