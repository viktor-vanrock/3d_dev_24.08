export const RELAY_CONTROL_CLOSE_SESSIONS_PATH = "/internal/relay/v1/sessions/close" as const;
export const RELAY_CONTROL_CANCEL_TRANSFERS_PATH = "/internal/relay/v1/transfers/cancel" as const;

export const RELAY_CONTROL_CLOSE_REASONS = ["agent_revoked", "owner_sanctioned", "admin_action"] as const;

export type RelayControlCloseReason = (typeof RELAY_CONTROL_CLOSE_REASONS)[number];

export interface CloseSessionsRequest {
  readonly agentIds: readonly string[];
  readonly reason: RelayControlCloseReason;
}

export interface CloseSessionsResponse {
  readonly closed: readonly string[];
  readonly notConnected: readonly string[];
}

export interface CancelTransfersRequest {
  readonly transferIds: readonly string[];
}

export interface CancelTransfersResponse {
  readonly cancelled: readonly string[];
  readonly notActive: readonly string[];
}
