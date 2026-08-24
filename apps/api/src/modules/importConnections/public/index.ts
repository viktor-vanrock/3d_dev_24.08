import type { UserId } from "../../_kernel/brandedIds.ts";
import type { ImportBindingSummary, ImportConnectionRow } from "../domain/import-connections.ts";

export const IMPORT_CONNECTIONS_PORT = Symbol("IMPORT_CONNECTIONS_PORT");
export const IMPORT_CONNECTIONS_EXTERNAL_PORT = Symbol("IMPORT_CONNECTIONS_EXTERNAL_PORT");
export { importOwnershipStatusForModel, markConnectionVerifiedByAuth } from "../infrastructure/import-ownership.repository.ts";
export { isVisibleToNonOwner, UNVERIFIED_IMPORT_EXISTS_SQL, UNVERIFIED_IMPORT_EXISTS_SQL_COMPAT } from "../infrastructure/model-import-visibility.ts";

export interface ExternalImportModelSummary {
  readonly externalId: string;
  readonly title: string;
  readonly originalUrl: string;
  readonly thumbnailUrl?: string;
}

export interface ImportConnectionsExternalPort {
  validateCredentials(input: { readonly username: string; readonly apiKey: string }): Promise<readonly ExternalImportModelSummary[]>;
  listModels(input: { readonly username: string; readonly apiKey: string }): Promise<readonly ExternalImportModelSummary[]>;
  encryptCredentials(apiKey: string): Buffer;
  decryptCredentials(value: Buffer): string;
}

export interface ImportConnectionsPort {
  exists(input: { readonly connectionId: string; readonly userId: UserId; readonly sourcePlatform: string }): Promise<boolean>;
  connect(
    userId: UserId,
    input: { readonly sourcePlatform: unknown; readonly username: unknown; readonly apiKey: unknown },
  ): Promise<{ readonly id: string; readonly source_platform: "cults3d"; readonly ownership_status: "verified"; readonly models_found: number }>;
  list(userId: UserId): Promise<{ readonly connections: readonly ImportConnectionRow[]; readonly bindings: readonly ImportBindingSummary[] }>;
  listModels(userId: UserId, connectionId: string): Promise<{ readonly models: readonly ExternalImportModelSummary[] }>;
  requestChallenge(userId: UserId, connectionId: string, target: unknown): Promise<{ readonly token: string }>;
  verifyChallenge(userId: UserId, connectionId: string, observedText: unknown): Promise<{ readonly ownership_status: "verified" | "rejected" }>;
}
export { ImportProviderUnavailableError, InvalidImportCredentialsError } from "../domain/import-connections.ts";
