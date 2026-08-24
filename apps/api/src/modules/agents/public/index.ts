import type { Request } from "express";
import type { UserId } from "../../_kernel/brandedIds.ts";

export const AGENTS_PORT = Symbol("AGENTS_PORT");
export const AGENTS_EXTERNAL_PORT = Symbol("AGENTS_EXTERNAL_PORT");
export const AGENTS_API_KEYS_PORT = Symbol("AGENTS_API_KEYS_PORT");
export { isActiveContentAgent } from "../infrastructure/agents.repository.ts";

export interface AgentRequestContext {
  readonly request: Request;
  readonly requestId: string;
}
export interface AgentAccountInput {
  readonly name?: unknown;
  readonly bio?: unknown;
  readonly runtime_label?: unknown;
}
export interface AgentAccount {
  readonly id: string;
  readonly name: string;
  readonly avatar_s3_key: string | null;
  readonly bio: string | null;
  readonly runtime_label: string | null;
  readonly status: string;
  readonly created_at: string;
  readonly revoked_at: string | null;
}
export interface AgentAccountResponse {
  readonly agent: AgentAccount;
}
export interface AgentPagination {
  readonly limit: number;
  readonly offset: number;
  readonly has_more: boolean;
  readonly next_offset: number | null;
}
export interface AgentListResponse {
  readonly agents: readonly AgentAccount[];
  readonly pagination: AgentPagination;
}
export interface AgentContentKey {
  readonly id: string;
  readonly label: string | null;
  readonly key_prefix: string;
  readonly status: string;
  readonly last_used_at: string | null;
  readonly created_at: string;
  readonly revoked_at: string | null;
}
export interface MintedAgentContentKey {
  readonly id: string;
  readonly key: string;
  readonly key_prefix: string;
  readonly scope: "agent_content";
  readonly agent_id: string;
  readonly label: string;
  readonly created_at: string;
}
export interface AgentKeyListResponse {
  readonly keys: readonly AgentContentKey[];
}

export interface AgentsExternalPort {
  assertRateLimit(request: Request, principalId: string): Promise<void>;
}
export interface AgentsApiKeysPort {
  mintAgentKey(ownerId: UserId, agentId: string, label: unknown): Promise<MintedAgentContentKey>;
  listAgentKeys(ownerId: UserId, agentId: string): Promise<readonly AgentContentKey[]>;
  revokeAgentKey(ownerId: UserId, agentId: string, keyId: string): Promise<boolean>;
  hasAgentKey(ownerId: UserId, agentId: string, keyId: string): Promise<boolean>;
  revokeAllAgentKeys(agentId: string): Promise<void>;
}
export interface AgentsPort {
  create(user: { readonly id: UserId; readonly username: string }, body: AgentAccountInput, context: AgentRequestContext): Promise<AgentAccountResponse>;
  list(userId: UserId, query: { readonly limit?: string; readonly offset?: string }, context: AgentRequestContext): Promise<AgentListResponse>;
  revoke(userId: UserId, id: string, context: AgentRequestContext): Promise<AgentAccountResponse>;
  mintKey(userId: UserId, id: string, label: unknown, context: AgentRequestContext): Promise<MintedAgentContentKey>;
  listKeys(userId: UserId, id: string, context: AgentRequestContext): Promise<AgentKeyListResponse>;
  revokeKey(userId: UserId, id: string, keyId: string, context: AgentRequestContext): Promise<void>;
}
