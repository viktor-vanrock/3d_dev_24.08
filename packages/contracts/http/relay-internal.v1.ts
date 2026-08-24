export const RELAY_INTERNAL_V1_PREFIX = "/internal/relay/v1" as const;

export type RelayInternalMethod = "GET" | "POST" | "PUT";
export type RelayRetrySemantics = "read" | "idempotent" | "idempotent_with_operation_id";

export interface RelayInternalOperation {
  readonly operationId: RelayInternalOperationId;
  readonly method: RelayInternalMethod;
  readonly path: `${typeof RELAY_INTERNAL_V1_PREFIX}${string}`;
  readonly capability: "session" | "gateway_revalidation" | "command" | "transfer";
  readonly retry: RelayRetrySemantics;
}

export type RelayInternalOperationId =
  | "relaySessionAuthorize"
  | "relaySessionHeartbeat"
  | "relaySessionClose"
  | "relayGatewaysRevalidate"
  | "relayCommandsClaim"
  | "relayCommandLeaseHeartbeat"
  | "relayCommandResult"
  | "relayTransferMetadata"
  | "relayTransferSourceUrl"
  | "relayTransferProgress"
  | "relayTransferResult";

export const RELAY_INTERNAL_V1_OPERATIONS = [
  {
    operationId: "relaySessionAuthorize",
    method: "POST",
    path: "/internal/relay/v1/sessions/authorize",
    capability: "session",
    retry: "idempotent_with_operation_id",
  },
  {
    operationId: "relaySessionHeartbeat",
    method: "POST",
    path: "/internal/relay/v1/sessions/{sessionId}/heartbeat",
    capability: "session",
    retry: "idempotent_with_operation_id",
  },
  {
    operationId: "relaySessionClose",
    method: "POST",
    path: "/internal/relay/v1/sessions/{sessionId}/close",
    capability: "session",
    retry: "idempotent_with_operation_id",
  },
  {
    operationId: "relayGatewaysRevalidate",
    method: "POST",
    path: "/internal/relay/v1/gateways/revalidate",
    capability: "gateway_revalidation",
    retry: "idempotent",
  },
  {
    operationId: "relayCommandsClaim",
    method: "POST",
    path: "/internal/relay/v1/commands/claim",
    capability: "command",
    retry: "idempotent_with_operation_id",
  },
  {
    operationId: "relayCommandLeaseHeartbeat",
    method: "POST",
    path: "/internal/relay/v1/commands/{commandId}/lease-heartbeat",
    capability: "command",
    retry: "idempotent_with_operation_id",
  },
  {
    operationId: "relayCommandResult",
    method: "PUT",
    path: "/internal/relay/v1/commands/{commandId}/result",
    capability: "command",
    retry: "idempotent_with_operation_id",
  },
  {
    operationId: "relayTransferMetadata",
    method: "GET",
    path: "/internal/relay/v1/transfers/{transferId}/metadata",
    capability: "transfer",
    retry: "read",
  },
  {
    operationId: "relayTransferSourceUrl",
    method: "POST",
    path: "/internal/relay/v1/transfers/{transferId}/source-url",
    capability: "transfer",
    retry: "idempotent_with_operation_id",
  },
  {
    operationId: "relayTransferProgress",
    method: "PUT",
    path: "/internal/relay/v1/transfers/{transferId}/progress",
    capability: "transfer",
    retry: "idempotent_with_operation_id",
  },
  {
    operationId: "relayTransferResult",
    method: "PUT",
    path: "/internal/relay/v1/transfers/{transferId}/result",
    capability: "transfer",
    retry: "idempotent_with_operation_id",
  },
] as const satisfies readonly RelayInternalOperation[];

/** Historical inventory only. Target code must never route or call these paths. */
export const LEGACY_RELAY_API_OPERATIONS = [
  "POST /internal/relay/session/open",
  "POST /internal/relay/session/heartbeat",
  "POST /internal/relay/session/close",
  "POST /internal/relay/session/print-result",
  "POST /internal/relay/commands/poll",
  "POST /internal/relay/commands/{commandId}/result",
  "GET /internal/relay/transfers/{transferId}/metadata",
  "POST /internal/relay/transfers/{transferId}/progress",
  "POST /internal/relay/command",
  "POST /internal/relay/files/send",
] as const;
