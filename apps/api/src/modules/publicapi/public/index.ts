import type { Request } from "express";
import type { UserId } from "../../_kernel/brandedIds.ts";
import type { PublicCommandStatusResponse, PublicPrinterResponse, PublicQueuedCommandResponse, PublicTelemetryItem, PublicTestQueryResponse } from "../../devices/public/index.ts";

export const PUBLICAPI_PORT = Symbol("PUBLICAPI_PORT");
export const PUBLICAPI_EXTERNAL_PORT = Symbol("PUBLICAPI_EXTERNAL_PORT");
export const PUBLICAPI_DEVICES_PORT = Symbol("PUBLICAPI_DEVICES_PORT");
export const AGENT_API_KEYS_PORT = Symbol("AGENT_API_KEYS_PORT");
export const PUBLIC_API_KEY_SCOPES = ["read", "control"] as const;
export type PublicApiKeyScope = (typeof PUBLIC_API_KEY_SCOPES)[number];

export interface PublicApiRequestContext {
  readonly request: Request;
  readonly requestId: string;
}
export interface PublicApiExternalPort {
  assertRateLimit(request: Request, principalId: string): Promise<void>;
}
export interface PublicApiKeyInput {
  readonly name?: unknown;
  readonly scopes?: unknown;
  readonly label?: unknown;
  readonly scope?: unknown;
}
export interface PublicApiKeySecret {
  readonly id: string;
  readonly key: string;
  readonly key_prefix: string;
  readonly name: string;
  readonly scopes: readonly PublicApiKeyScope[];
  readonly created_at: string;
}
export interface PublicApiKey {
  readonly id: string;
  readonly name: string;
  readonly key_prefix: string;
  readonly scopes: readonly PublicApiKeyScope[];
  readonly revoked_at: string | null;
  readonly last_used_at: string | null;
  readonly created_at: string;
}
export interface UserApiKeySecret {
  readonly id: string;
  readonly key: string;
  readonly key_prefix: string;
  readonly scope: string;
  readonly label: string;
  readonly created_at: string;
}
export interface UserApiKey {
  readonly id: string;
  readonly label: string | null;
  readonly key_prefix: string;
  readonly scope: string;
  readonly status: string;
  readonly last_used_at: string | null;
  readonly created_at: string;
  readonly revoked_at: string | null;
}
export interface Pagination {
  readonly limit: number;
  readonly offset: number;
  readonly has_more: boolean;
  readonly next_offset: number | null;
}
export interface AgentApiKey {
  readonly id: string;
  readonly label: string | null;
  readonly key_prefix: string;
  readonly status: string;
  readonly last_used_at: string | null;
  readonly created_at: string;
  readonly revoked_at: string | null;
}
export interface MintedAgentApiKey {
  readonly id: string;
  readonly key: string;
  readonly key_prefix: string;
  readonly scope: "agent_content";
  readonly agent_id: string;
  readonly label: string;
  readonly created_at: string;
}

export interface PublicApiDevicesPort {
  listPrinters(ownerId: UserId): Promise<{ readonly printers: readonly PublicPrinterResponse[] }>;
  printer(ownerId: UserId, deviceId: string): Promise<PublicPrinterResponse>;
  telemetry(ownerId: UserId, deviceId: string, query: { readonly limit?: string; readonly since?: string }): Promise<{ readonly telemetry: readonly PublicTelemetryItem[] }>;
  testJobCommand(
    ownerId: UserId,
    deviceId: string,
    body: Readonly<Record<string, unknown>>,
    idempotencyKey: unknown,
    requestId: string,
  ): Promise<{ readonly status: number; readonly body: PublicTestQueryResponse | PublicQueuedCommandResponse }>;
  command(
    ownerId: UserId,
    deviceId: string,
    body: Readonly<Record<string, unknown>>,
    idempotencyKey: unknown,
    requestId: string,
    hasControlScope: boolean,
  ): Promise<{ readonly status: number; readonly body: PublicQueuedCommandResponse }>;
  commandStatus(ownerId: UserId, deviceId: string, commandId: string): Promise<PublicCommandStatusResponse>;
}
export interface AgentApiKeysPort {
  mintAgentKey(ownerId: UserId, agentId: string, label: unknown): Promise<MintedAgentApiKey>;
  listAgentKeys(ownerId: UserId, agentId: string): Promise<readonly AgentApiKey[]>;
  revokeAgentKey(ownerId: UserId, agentId: string, keyId: string): Promise<boolean>;
  hasAgentKey(ownerId: UserId, agentId: string, keyId: string): Promise<boolean>;
  revokeAllAgentKeys(agentId: string): Promise<void>;
}
export interface PublicApiPort {
  createApiKey(ownerId: UserId, body: PublicApiKeyInput, context: PublicApiRequestContext): Promise<PublicApiKeySecret>;
  listApiKeys(ownerId: UserId, context: PublicApiRequestContext): Promise<{ readonly keys: readonly PublicApiKey[] }>;
  revokeApiKey(ownerId: UserId, id: string, context: PublicApiRequestContext): Promise<void>;
  rotateApiKey(ownerId: UserId, id: string, body: PublicApiKeyInput, context: PublicApiRequestContext): Promise<PublicApiKeySecret>;
  createUserApiKey(ownerId: UserId, body: PublicApiKeyInput, context: PublicApiRequestContext): Promise<UserApiKeySecret>;
  listUserApiKeys(
    ownerId: UserId,
    query: { readonly limit?: string; readonly offset?: string; readonly scope?: string },
    context: PublicApiRequestContext,
  ): Promise<{ readonly keys: readonly UserApiKey[]; readonly pagination: Pagination }>;
  revokeUserApiKey(ownerId: UserId, id: string, context: PublicApiRequestContext): Promise<void>;
  authenticate(
    rawAuthorization: string | undefined,
    requiredScope: PublicApiKeyScope,
    context: PublicApiRequestContext,
  ): Promise<{ readonly id: string; readonly ownerId: UserId; readonly scopes: readonly PublicApiKeyScope[] }>;
}
