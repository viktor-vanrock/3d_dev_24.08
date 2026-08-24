import type { UserId } from "../../_kernel/brandedIds.ts";
import type { ModelOwnerPort } from "../../models/public/index.ts";

export const IMPORTS_PORT = Symbol("IMPORTS_PORT");
export const IMPORTS_MODEL_OWNER_PORT = Symbol("IMPORTS_MODEL_OWNER_PORT");
export const IMPORTS_CONNECTION_READ_PORT = Symbol("IMPORTS_CONNECTION_READ_PORT");
export type ImportsModelOwnerPort = Pick<ModelOwnerPort, "createImportedModel" | "updateImportedModel" | "deleteModelFiles" | "addModelFile" | "replaceModelTags">;
export interface ImportsConnectionReadPort {
  exists(input: { readonly connectionId: string; readonly userId: UserId; readonly sourcePlatform: string }): Promise<boolean>;
}

export interface ImportJobProgress {
  readonly id: string;
  readonly source_platform: string;
  readonly status: string;
  readonly total_count: number;
  readonly done_count: number;
  readonly failed_count: number;
  readonly created_at: Date | string;
  readonly started_at: Date | string | null;
  readonly finished_at: Date | string | null;
}

export interface ImportJobItemProgress {
  readonly external_id: string;
  readonly status: string;
  readonly retryable: boolean;
  readonly attempt_count: number;
  readonly last_error: string | null;
}

export interface ImportJobDetail extends ImportJobProgress {
  readonly items: readonly ImportJobItemProgress[];
}

export interface EnqueueImportJobInput {
  readonly connectionId: string;
  readonly sourcePlatform: string;
  readonly externalIds: readonly string[];
}

export interface ImportsPort {
  enqueue(
    userId: UserId,
    input: EnqueueImportJobInput,
  ): Promise<{ readonly id: string; readonly status: "queued"; readonly total_count: number; readonly done_count: 0; readonly failed_count: 0 }>;
  list(userId: UserId): Promise<{ readonly jobs: readonly ImportJobProgress[] }>;
  detail(userId: UserId, id: string): Promise<ImportJobDetail>;
}
export { createCults3dConnector } from "../infrastructure/cults3d.ts";
export type { ImportAuth } from "../infrastructure/connector.ts";
export { PermanentImportItemError } from "../domain/import-errors.ts";
