export const RELAY_CONTROL_CLOSE_SESSIONS_PATH = "/internal/relay/v1/sessions/close" as const;

export const RELAY_CONTROL_CLOSE_REASONS = ["agent_revoked", "owner_blocked", "owner_sanctioned", "admin_action"] as const;

export type RelayControlCloseReason = (typeof RELAY_CONTROL_CLOSE_REASONS)[number];

export interface CloseSessionsRequest {
  readonly agentIds: readonly string[];
  readonly reason: RelayControlCloseReason;
}

export interface CloseSessionsResponse {
  readonly closed: readonly string[];
  readonly notConnected: readonly string[];
}
