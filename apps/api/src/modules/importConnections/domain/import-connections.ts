export class InvalidImportCredentialsError extends Error {}

export class ImportProviderUnavailableError extends Error {}

export interface StoredImportConnectionCredential {
  readonly credential_enc: Buffer;
  readonly external_username: string | null;
}

export interface ImportConnectionRow {
  readonly id: string;
  readonly source_platform: string;
  readonly external_username: string | null;
  readonly ownership_status: string;
  readonly challenge_token: string | null;
  readonly challenge_target: string | null;
  readonly status: string;
  readonly last_error: string | null;
  readonly last_synced_at: Date | string | null;
  readonly created_at: Date | string;
}

export interface ImportBindingSummary {
  readonly id: string;
  readonly model_id: string;
  readonly source_platform: string;
  readonly external_id: string;
  readonly ownership_status: string;
  readonly imported_at: Date | string;
}
