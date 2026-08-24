export interface paths {
    readonly "/internal/relay/v1/commands/{commandId}/lease-heartbeat": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get?: never;
        readonly put?: never;
        readonly post: operations["relayCommandLeaseHeartbeat"];
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/internal/relay/v1/commands/{commandId}/result": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get?: never;
        readonly put: operations["relayCommandResult"];
        readonly post?: never;
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/internal/relay/v1/commands/claim": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get?: never;
        readonly put?: never;
        readonly post: operations["relayCommandsClaim"];
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/internal/relay/v1/gateways/revalidate": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get?: never;
        readonly put?: never;
        readonly post: operations["relayGatewaysRevalidate"];
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/internal/relay/v1/sessions/{sessionId}/close": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get?: never;
        readonly put?: never;
        readonly post: operations["relaySessionClose"];
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/internal/relay/v1/sessions/{sessionId}/heartbeat": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get?: never;
        readonly put?: never;
        readonly post: operations["relaySessionHeartbeat"];
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/internal/relay/v1/sessions/authorize": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get?: never;
        readonly put?: never;
        readonly post: operations["relaySessionAuthorize"];
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/internal/relay/v1/transfers/{transferId}/metadata": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get: operations["relayTransferMetadata"];
        readonly put?: never;
        readonly post?: never;
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/internal/relay/v1/transfers/{transferId}/progress": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get?: never;
        readonly put: operations["relayTransferProgress"];
        readonly post?: never;
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/internal/relay/v1/transfers/{transferId}/result": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get?: never;
        readonly put: operations["relayTransferResult"];
        readonly post?: never;
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/internal/relay/v1/transfers/{transferId}/source-url": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get?: never;
        readonly put?: never;
        readonly post: operations["relayTransferSourceUrl"];
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
}
export type webhooks = Record<string, never>;
export interface components {
    schemas: {
        readonly RelayAuthorizedDeviceDto: {
            readonly authorization_revision: number;
            readonly device_id: components["schemas"]["RelayIdentifier"];
        };
        readonly RelayClaimedCommandDto: {
            readonly attempt_count: number;
            readonly claim_owner: components["schemas"]["RelayIdentifier"];
            readonly claim_token: string;
            readonly command_id: components["schemas"]["RelayIdentifier"];
            readonly command_seq: number;
            readonly command_token: string;
            readonly device_id: components["schemas"]["RelayIdentifier"];
            readonly expires_at: components["schemas"]["RelayTimestamp"];
            readonly generation: number;
            readonly lease_expires_at: components["schemas"]["RelayTimestamp"];
            readonly max_attempts: number;
            readonly payload: components["schemas"]["RelayCommandPayloadDto"];
            /** @constant */
            readonly status: "leased";
        };
        readonly RelayCommandFenceDto: {
            readonly claim_owner: components["schemas"]["RelayIdentifier"];
            readonly claim_token: string;
            readonly generation: number;
        };
        readonly RelayCommandLeaseHeartbeatRequestDto: {
            readonly claim_owner: components["schemas"]["RelayIdentifier"];
            readonly claim_token: string;
            /** @enum {string} */
            readonly delivery_state: "leased" | "delivered" | "acknowledged";
            readonly generation: number;
            readonly observed_at: components["schemas"]["RelayTimestamp"];
        };
        readonly RelayCommandLeaseHeartbeatResponseDto: {
            readonly command_id: components["schemas"]["RelayIdentifier"];
            readonly generation: number;
            readonly lease_expires_at: components["schemas"]["RelayTimestamp"];
            readonly replayed: boolean;
            /** @enum {string} */
            readonly status: "leased" | "delivered" | "acknowledged";
        };
        readonly RelayCommandPayloadDto: {
            /** @enum {string} */
            readonly command: "start" | "pause" | "resume" | "cancel";
            readonly file_name?: string;
        };
        readonly RelayCommandResultRequestDto: {
            readonly claim_owner: components["schemas"]["RelayIdentifier"];
            readonly claim_token: string;
            readonly command_seq: number;
            /** @enum {string} */
            readonly error_code?: "device_not_owned" | "device_revoked" | "blocked_config" | "replay_rejected" | "invalid_token" | "role_not_allowed" | "command_not_supported" | "driver_error" | "command_failed" | "timeout" | "disconnected" | "internal_error";
            readonly generation: number;
            readonly observed_at: components["schemas"]["RelayTimestamp"];
            /** @enum {string} */
            readonly status: "executed" | "failed";
        };
        readonly RelayCommandResultResponseDto: {
            readonly command_id: components["schemas"]["RelayIdentifier"];
            readonly command_seq: number;
            readonly generation: number;
            readonly persisted_at: components["schemas"]["RelayTimestamp"];
            readonly replayed: boolean;
            readonly status: components["schemas"]["RelayCommandStatus"];
        };
        readonly RelayCommandsClaimRequestDto: {
            readonly authorization_revision: number;
            readonly claim_owner: components["schemas"]["RelayIdentifier"];
            readonly gateway_id: components["schemas"]["RelayIdentifier"];
            readonly limit: number;
            readonly session_generation: number;
            readonly session_id: components["schemas"]["RelayIdentifier"];
        };
        readonly RelayCommandsClaimResponseDto: {
            readonly claim_owner: components["schemas"]["RelayIdentifier"];
            readonly claimed_at: components["schemas"]["RelayTimestamp"];
            readonly commands: readonly components["schemas"]["RelayClaimedCommandDto"][];
            readonly replayed: boolean;
        };
        /** @enum {string} */
        readonly RelayCommandStatus: "queued" | "leased" | "delivered" | "acknowledged" | "executed" | "failed" | "expired";
        readonly RelayCorrelationId: string;
        readonly RelayDeviceHeartbeatDto: {
            readonly bytes_available?: number;
            readonly device_id: components["schemas"]["RelayIdentifier"];
            readonly firmware_version?: string;
            readonly model?: string;
            readonly progress_percent: number;
            readonly sequence: number;
            /** @enum {string} */
            readonly state: "idle" | "printing" | "paused" | "error" | "offline";
            readonly temperature_c?: number;
        };
        readonly RelayGatewayRevalidationRequestItemDto: {
            readonly gateway_id: components["schemas"]["RelayIdentifier"];
            readonly known_authorization_revision: number;
            readonly session_generation: number;
            readonly session_id: components["schemas"]["RelayIdentifier"];
        };
        readonly RelayGatewayRevalidationResultDto: {
            readonly authorization_revision: number;
            readonly authorized_devices: readonly components["schemas"]["RelayAuthorizedDeviceDto"][];
            readonly gateway_id: components["schemas"]["RelayIdentifier"];
            readonly session_generation: number;
            readonly session_id: components["schemas"]["RelayIdentifier"];
            /** @enum {string} */
            readonly state: "authorized" | "revoked" | "superseded" | "unknown";
        };
        readonly RelayGatewaysRevalidateRequestDto: {
            readonly gateways: readonly components["schemas"]["RelayGatewayRevalidationRequestItemDto"][];
        };
        readonly RelayGatewaysRevalidateResponseDto: {
            readonly results: readonly components["schemas"]["RelayGatewayRevalidationResultDto"][];
            readonly validated_at: components["schemas"]["RelayTimestamp"];
        };
        readonly RelayIdentifier: string;
        /** @enum {string} */
        readonly RelayInternalErrorCode: "relay.validation.invalid.v1" | "relay.auth.invalid_service_credential.v1" | "relay.auth.gateway_forbidden.v1" | "relay.session.not_found.v1" | "relay.session.conflict.v1" | "relay.command.not_found.v1" | "relay.command.fence_conflict.v1" | "relay.command.result_conflict.v1" | "relay.transfer.not_found.v1" | "relay.transfer.source_changed.v1" | "relay.idempotency.conflict.v1" | "relay.rate_limited.v1" | "relay.service_unavailable.v1" | "relay.internal.v1";
        readonly RelayInternalErrorDto: {
            readonly code: components["schemas"]["RelayInternalErrorCode"];
            readonly message: string;
            readonly operation_id?: components["schemas"]["RelayOperationId"];
            readonly request_id: components["schemas"]["RelayCorrelationId"];
            readonly retry_after_ms?: number;
            readonly retryable: boolean;
        };
        readonly RelayInternalErrorEnvelopeDto: {
            readonly error: components["schemas"]["RelayInternalErrorDto"];
        };
        readonly RelayOperationId: string;
        readonly RelaySessionAuthorizeRequestDto: {
            readonly agent_version: string;
            readonly capabilities: readonly ("heartbeat.v1" | "commands.v1" | "files.v1" | "command_results.v1" | "file_resume.v1")[];
            readonly certificate_fingerprint_sha256: string;
            readonly gateway_identity: components["schemas"]["RelayIdentifier"];
            /** @constant */
            readonly protocol_version: "v1";
        };
        readonly RelaySessionAuthorizeResponseDto: {
            readonly authorization_revision: number;
            readonly authorized_devices: readonly components["schemas"]["RelayAuthorizedDeviceDto"][];
            readonly gateway_id: components["schemas"]["RelayIdentifier"];
            readonly heartbeat_interval_ms: number;
            readonly heartbeat_timeout_ms: number;
            readonly pending_transfer_ids: readonly components["schemas"]["RelayIdentifier"][];
            readonly session_generation: number;
            readonly session_id: components["schemas"]["RelayIdentifier"];
        };
        readonly RelaySessionCloseRequestDto: {
            readonly closed_at: components["schemas"]["RelayTimestamp"];
            readonly gateway_id: components["schemas"]["RelayIdentifier"];
            /** @enum {string} */
            readonly reason: "client_close" | "heartbeat_timeout" | "replaced" | "revoked" | "api_unavailable" | "protocol_error" | "rate_limited" | "backpressure" | "shutdown";
            readonly session_generation: number;
        };
        readonly RelaySessionCloseResponseDto: {
            readonly closed_at: components["schemas"]["RelayTimestamp"];
            readonly replayed: boolean;
            readonly session_generation: number;
            readonly session_id: components["schemas"]["RelayIdentifier"];
        };
        readonly RelaySessionHeartbeatRequestDto: {
            readonly authorization_revision: number;
            readonly devices: readonly components["schemas"]["RelayDeviceHeartbeatDto"][];
            readonly gateway_id: components["schemas"]["RelayIdentifier"];
            readonly observed_at: components["schemas"]["RelayTimestamp"];
            readonly session_generation: number;
        };
        readonly RelaySessionHeartbeatResponseDto: {
            readonly accepted_device_ids: readonly components["schemas"]["RelayIdentifier"][];
            readonly authorization_revision: number;
            readonly pending_transfer_ids: readonly components["schemas"]["RelayIdentifier"][];
            readonly persisted_at: components["schemas"]["RelayTimestamp"];
            readonly replayed: boolean;
            readonly session_generation: number;
            readonly session_id: components["schemas"]["RelayIdentifier"];
        };
        /** @enum {string} */
        readonly RelayTerminalCommandStatus: "executed" | "failed" | "expired";
        /** Format: date-time */
        readonly RelayTimestamp: string;
        readonly RelayTransferMetadataResponseDto: {
            readonly chunk_size_bytes: number;
            /** @enum {string} */
            readonly content_type: "application/octet-stream" | "text/plain" | "application/vnd.3mfmodel" | "model/gcode";
            readonly device_id: components["schemas"]["RelayIdentifier"];
            readonly file_name: string;
            readonly gateway_id: components["schemas"]["RelayIdentifier"];
            /** @enum {string} */
            readonly kind: "gcode" | "printer_profile";
            readonly next_offset: number;
            readonly next_sequence: number;
            readonly object_version: string;
            readonly session_generation: number;
            readonly session_id: components["schemas"]["RelayIdentifier"];
            readonly sha256: string;
            readonly size_bytes: number;
            readonly start_print: boolean;
            readonly transfer_id: components["schemas"]["RelayIdentifier"];
        };
        readonly RelayTransferProgressRequestDto: {
            readonly next_offset: number;
            readonly next_sequence: number;
            readonly object_version: string;
            readonly observed_at: components["schemas"]["RelayTimestamp"];
            readonly session_generation: number;
            readonly session_id: components["schemas"]["RelayIdentifier"];
        };
        readonly RelayTransferProgressResponseDto: {
            readonly next_offset: number;
            readonly next_sequence: number;
            readonly persisted_at: components["schemas"]["RelayTimestamp"];
            readonly replayed: boolean;
            readonly transfer_id: components["schemas"]["RelayIdentifier"];
        };
        readonly RelayTransferResultRequestDto: {
            /** @enum {string} */
            readonly error_code?: "device_not_owned" | "device_revoked" | "invalid_transfer" | "invalid_file" | "transfer_conflict" | "invalid_sequence" | "checksum_mismatch" | "size_mismatch" | "source_changed" | "upload_failed" | "start_failed" | "timeout" | "disconnected" | "internal_error";
            readonly next_offset: number;
            readonly next_sequence: number;
            readonly object_version: string;
            readonly observed_at: components["schemas"]["RelayTimestamp"];
            readonly session_generation: number;
            readonly session_id: components["schemas"]["RelayIdentifier"];
            /** @enum {string} */
            readonly status: "completed" | "failed";
        };
        readonly RelayTransferResultResponseDto: {
            readonly next_offset: number;
            readonly next_sequence: number;
            readonly persisted_at: components["schemas"]["RelayTimestamp"];
            readonly replayed: boolean;
            /** @enum {string} */
            readonly status: "completed" | "failed";
            readonly transfer_id: components["schemas"]["RelayIdentifier"];
        };
        readonly RelayTransferSourceUrlRequestDto: {
            readonly next_offset: number;
            readonly next_sequence: number;
            readonly object_version: string;
            readonly session_generation: number;
            readonly session_id: components["schemas"]["RelayIdentifier"];
            readonly sha256: string;
            readonly size_bytes: number;
        };
        readonly RelayTransferSourceUrlResponseDto: {
            readonly expires_at: components["schemas"]["RelayTimestamp"];
            readonly next_offset: number;
            readonly next_sequence: number;
            readonly object_version: string;
            /** @constant */
            readonly range_supported: true;
            readonly sha256: string;
            readonly size_bytes: number;
            /** Format: uri */
            readonly source_url: string;
            readonly transfer_id: components["schemas"]["RelayIdentifier"];
        };
    };
    responses: {
        /** @description Current lease renewed */
        readonly RelayCommandLeaseHeartbeatSuccess: {
            headers: {
                readonly "x-correlation-id": components["headers"]["RelayCorrelationId"];
            };
            content: {
                readonly "application/json": components["schemas"]["RelayCommandLeaseHeartbeatResponseDto"];
            };
        };
        /** @description Command transition accepted or replayed */
        readonly RelayCommandResultSuccess: {
            headers: {
                readonly "x-correlation-id": components["headers"]["RelayCorrelationId"];
            };
            content: {
                readonly "application/json": components["schemas"]["RelayCommandResultResponseDto"];
            };
        };
        /** @description Bounded command claim batch */
        readonly RelayCommandsClaimSuccess: {
            headers: {
                readonly "x-correlation-id": components["headers"]["RelayCorrelationId"];
            };
            content: {
                readonly "application/json": components["schemas"]["RelayCommandsClaimResponseDto"];
            };
        };
        /** @description Current authorization for every requested gateway */
        readonly RelayGatewaysRevalidateSuccess: {
            headers: {
                readonly "x-correlation-id": components["headers"]["RelayCorrelationId"];
            };
            content: {
                readonly "application/json": components["schemas"]["RelayGatewaysRevalidateResponseDto"];
            };
        };
        /** @description Versioned safe relay error */
        readonly RelayInternalError: {
            headers: {
                readonly "x-correlation-id": components["headers"]["RelayCorrelationId"];
            };
            content: {
                readonly "application/json": components["schemas"]["RelayInternalErrorEnvelopeDto"];
            };
        };
        /** @description Gateway session authorized */
        readonly RelaySessionAuthorizeSuccess: {
            headers: {
                readonly "x-correlation-id": components["headers"]["RelayCorrelationId"];
            };
            content: {
                readonly "application/json": components["schemas"]["RelaySessionAuthorizeResponseDto"];
            };
        };
        /** @description Session close persisted */
        readonly RelaySessionCloseSuccess: {
            headers: {
                readonly "x-correlation-id": components["headers"]["RelayCorrelationId"];
            };
            content: {
                readonly "application/json": components["schemas"]["RelaySessionCloseResponseDto"];
            };
        };
        /** @description Session heartbeat persisted */
        readonly RelaySessionHeartbeatSuccess: {
            headers: {
                readonly "x-correlation-id": components["headers"]["RelayCorrelationId"];
            };
            content: {
                readonly "application/json": components["schemas"]["RelaySessionHeartbeatResponseDto"];
            };
        };
        /** @description Authorized immutable transfer metadata */
        readonly RelayTransferMetadataSuccess: {
            headers: {
                readonly "x-correlation-id": components["headers"]["RelayCorrelationId"];
            };
            content: {
                readonly "application/json": components["schemas"]["RelayTransferMetadataResponseDto"];
            };
        };
        /** @description Transfer progress accepted or replayed */
        readonly RelayTransferProgressSuccess: {
            headers: {
                readonly "x-correlation-id": components["headers"]["RelayCorrelationId"];
            };
            content: {
                readonly "application/json": components["schemas"]["RelayTransferProgressResponseDto"];
            };
        };
        /** @description Transfer terminal result accepted or replayed */
        readonly RelayTransferResultSuccess: {
            headers: {
                readonly "x-correlation-id": components["headers"]["RelayCorrelationId"];
            };
            content: {
                readonly "application/json": components["schemas"]["RelayTransferResultResponseDto"];
            };
        };
        /** @description Short-lived source URL for one immutable object version */
        readonly RelayTransferSourceUrlSuccess: {
            headers: {
                readonly "cache-control": components["headers"]["RelayNoStore"];
                readonly "x-correlation-id": components["headers"]["RelayCorrelationId"];
            };
            content: {
                readonly "application/json": components["schemas"]["RelayTransferSourceUrlResponseDto"];
            };
        };
    };
    parameters: {
        readonly CommandId: components["schemas"]["RelayIdentifier"];
        readonly CorrelationId: components["schemas"]["RelayCorrelationId"];
        readonly OperationId: components["schemas"]["RelayOperationId"];
        /** @description Relay-only service credential; gateway credentials are never accepted. */
        readonly RelayServiceCredential: string;
        readonly SessionGenerationQuery: number;
        readonly SessionId: components["schemas"]["RelayIdentifier"];
        readonly SessionIdQuery: components["schemas"]["RelayIdentifier"];
        readonly TransferId: components["schemas"]["RelayIdentifier"];
    };
    requestBodies: {
        readonly RelayCommandLeaseHeartbeatBody: {
            readonly content: {
                readonly "application/json": components["schemas"]["RelayCommandLeaseHeartbeatRequestDto"];
            };
        };
        readonly RelayCommandResultBody: {
            readonly content: {
                readonly "application/json": components["schemas"]["RelayCommandResultRequestDto"];
            };
        };
        readonly RelayCommandsClaimBody: {
            readonly content: {
                readonly "application/json": components["schemas"]["RelayCommandsClaimRequestDto"];
            };
        };
        readonly RelayGatewaysRevalidateBody: {
            readonly content: {
                readonly "application/json": components["schemas"]["RelayGatewaysRevalidateRequestDto"];
            };
        };
        readonly RelaySessionAuthorizeBody: {
            readonly content: {
                readonly "application/json": components["schemas"]["RelaySessionAuthorizeRequestDto"];
            };
        };
        readonly RelaySessionCloseBody: {
            readonly content: {
                readonly "application/json": components["schemas"]["RelaySessionCloseRequestDto"];
            };
        };
        readonly RelaySessionHeartbeatBody: {
            readonly content: {
                readonly "application/json": components["schemas"]["RelaySessionHeartbeatRequestDto"];
            };
        };
        readonly RelayTransferProgressBody: {
            readonly content: {
                readonly "application/json": components["schemas"]["RelayTransferProgressRequestDto"];
            };
        };
        readonly RelayTransferResultBody: {
            readonly content: {
                readonly "application/json": components["schemas"]["RelayTransferResultRequestDto"];
            };
        };
        readonly RelayTransferSourceUrlBody: {
            readonly content: {
                readonly "application/json": components["schemas"]["RelayTransferSourceUrlRequestDto"];
            };
        };
    };
    headers: {
        readonly RelayCorrelationId: components["schemas"]["RelayCorrelationId"];
        readonly RelayNoStore: "no-store";
    };
    pathItems: never;
}
export type $defs = Record<string, never>;
export interface operations {
    readonly relayCommandLeaseHeartbeat: {
        readonly parameters: {
            readonly query?: never;
            readonly header: {
                readonly "x-correlation-id": components["parameters"]["CorrelationId"];
                readonly "x-operation-id": components["parameters"]["OperationId"];
                /** @description Relay-only service credential; gateway credentials are never accepted. */
                readonly "x-relay-service-token": components["parameters"]["RelayServiceCredential"];
            };
            readonly path: {
                readonly commandId: components["parameters"]["CommandId"];
            };
            readonly cookie?: never;
        };
        readonly requestBody: components["requestBodies"]["RelayCommandLeaseHeartbeatBody"];
        readonly responses: {
            readonly 200: components["responses"]["RelayCommandLeaseHeartbeatSuccess"];
            readonly 400: components["responses"]["RelayInternalError"];
            readonly 401: components["responses"]["RelayInternalError"];
            readonly 403: components["responses"]["RelayInternalError"];
            readonly 404: components["responses"]["RelayInternalError"];
            readonly 409: components["responses"]["RelayInternalError"];
            readonly 503: components["responses"]["RelayInternalError"];
        };
    };
    readonly relayCommandResult: {
        readonly parameters: {
            readonly query?: never;
            readonly header: {
                readonly "x-correlation-id": components["parameters"]["CorrelationId"];
                readonly "x-operation-id": components["parameters"]["OperationId"];
                /** @description Relay-only service credential; gateway credentials are never accepted. */
                readonly "x-relay-service-token": components["parameters"]["RelayServiceCredential"];
            };
            readonly path: {
                readonly commandId: components["parameters"]["CommandId"];
            };
            readonly cookie?: never;
        };
        readonly requestBody: components["requestBodies"]["RelayCommandResultBody"];
        readonly responses: {
            readonly 200: components["responses"]["RelayCommandResultSuccess"];
            readonly 400: components["responses"]["RelayInternalError"];
            readonly 401: components["responses"]["RelayInternalError"];
            readonly 403: components["responses"]["RelayInternalError"];
            readonly 404: components["responses"]["RelayInternalError"];
            readonly 409: components["responses"]["RelayInternalError"];
            readonly 503: components["responses"]["RelayInternalError"];
        };
    };
    readonly relayCommandsClaim: {
        readonly parameters: {
            readonly query?: never;
            readonly header: {
                readonly "x-correlation-id": components["parameters"]["CorrelationId"];
                readonly "x-operation-id": components["parameters"]["OperationId"];
                /** @description Relay-only service credential; gateway credentials are never accepted. */
                readonly "x-relay-service-token": components["parameters"]["RelayServiceCredential"];
            };
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly requestBody: components["requestBodies"]["RelayCommandsClaimBody"];
        readonly responses: {
            readonly 200: components["responses"]["RelayCommandsClaimSuccess"];
            readonly 400: components["responses"]["RelayInternalError"];
            readonly 401: components["responses"]["RelayInternalError"];
            readonly 403: components["responses"]["RelayInternalError"];
            readonly 409: components["responses"]["RelayInternalError"];
            readonly 503: components["responses"]["RelayInternalError"];
        };
    };
    readonly relayGatewaysRevalidate: {
        readonly parameters: {
            readonly query?: never;
            readonly header: {
                readonly "x-correlation-id": components["parameters"]["CorrelationId"];
                /** @description Relay-only service credential; gateway credentials are never accepted. */
                readonly "x-relay-service-token": components["parameters"]["RelayServiceCredential"];
            };
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly requestBody: components["requestBodies"]["RelayGatewaysRevalidateBody"];
        readonly responses: {
            readonly 200: components["responses"]["RelayGatewaysRevalidateSuccess"];
            readonly 400: components["responses"]["RelayInternalError"];
            readonly 401: components["responses"]["RelayInternalError"];
            readonly 403: components["responses"]["RelayInternalError"];
            readonly 503: components["responses"]["RelayInternalError"];
        };
    };
    readonly relaySessionClose: {
        readonly parameters: {
            readonly query?: never;
            readonly header: {
                readonly "x-correlation-id": components["parameters"]["CorrelationId"];
                readonly "x-operation-id": components["parameters"]["OperationId"];
                /** @description Relay-only service credential; gateway credentials are never accepted. */
                readonly "x-relay-service-token": components["parameters"]["RelayServiceCredential"];
            };
            readonly path: {
                readonly sessionId: components["parameters"]["SessionId"];
            };
            readonly cookie?: never;
        };
        readonly requestBody: components["requestBodies"]["RelaySessionCloseBody"];
        readonly responses: {
            readonly 200: components["responses"]["RelaySessionCloseSuccess"];
            readonly 400: components["responses"]["RelayInternalError"];
            readonly 401: components["responses"]["RelayInternalError"];
            readonly 403: components["responses"]["RelayInternalError"];
            readonly 404: components["responses"]["RelayInternalError"];
            readonly 409: components["responses"]["RelayInternalError"];
            readonly 503: components["responses"]["RelayInternalError"];
        };
    };
    readonly relaySessionHeartbeat: {
        readonly parameters: {
            readonly query?: never;
            readonly header: {
                readonly "x-correlation-id": components["parameters"]["CorrelationId"];
                readonly "x-operation-id": components["parameters"]["OperationId"];
                /** @description Relay-only service credential; gateway credentials are never accepted. */
                readonly "x-relay-service-token": components["parameters"]["RelayServiceCredential"];
            };
            readonly path: {
                readonly sessionId: components["parameters"]["SessionId"];
            };
            readonly cookie?: never;
        };
        readonly requestBody: components["requestBodies"]["RelaySessionHeartbeatBody"];
        readonly responses: {
            readonly 200: components["responses"]["RelaySessionHeartbeatSuccess"];
            readonly 400: components["responses"]["RelayInternalError"];
            readonly 401: components["responses"]["RelayInternalError"];
            readonly 403: components["responses"]["RelayInternalError"];
            readonly 404: components["responses"]["RelayInternalError"];
            readonly 409: components["responses"]["RelayInternalError"];
            readonly 503: components["responses"]["RelayInternalError"];
        };
    };
    readonly relaySessionAuthorize: {
        readonly parameters: {
            readonly query?: never;
            readonly header: {
                readonly "x-correlation-id": components["parameters"]["CorrelationId"];
                readonly "x-operation-id": components["parameters"]["OperationId"];
                /** @description Relay-only service credential; gateway credentials are never accepted. */
                readonly "x-relay-service-token": components["parameters"]["RelayServiceCredential"];
            };
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly requestBody: components["requestBodies"]["RelaySessionAuthorizeBody"];
        readonly responses: {
            readonly 200: components["responses"]["RelaySessionAuthorizeSuccess"];
            readonly 400: components["responses"]["RelayInternalError"];
            readonly 401: components["responses"]["RelayInternalError"];
            readonly 403: components["responses"]["RelayInternalError"];
            readonly 409: components["responses"]["RelayInternalError"];
            readonly 503: components["responses"]["RelayInternalError"];
        };
    };
    readonly relayTransferMetadata: {
        readonly parameters: {
            readonly query: {
                readonly session_generation: components["parameters"]["SessionGenerationQuery"];
                readonly session_id: components["parameters"]["SessionIdQuery"];
            };
            readonly header: {
                readonly "x-correlation-id": components["parameters"]["CorrelationId"];
                /** @description Relay-only service credential; gateway credentials are never accepted. */
                readonly "x-relay-service-token": components["parameters"]["RelayServiceCredential"];
            };
            readonly path: {
                readonly transferId: components["parameters"]["TransferId"];
            };
            readonly cookie?: never;
        };
        readonly requestBody?: never;
        readonly responses: {
            readonly 200: components["responses"]["RelayTransferMetadataSuccess"];
            readonly 400: components["responses"]["RelayInternalError"];
            readonly 401: components["responses"]["RelayInternalError"];
            readonly 403: components["responses"]["RelayInternalError"];
            readonly 404: components["responses"]["RelayInternalError"];
            readonly 503: components["responses"]["RelayInternalError"];
        };
    };
    readonly relayTransferProgress: {
        readonly parameters: {
            readonly query?: never;
            readonly header: {
                readonly "x-correlation-id": components["parameters"]["CorrelationId"];
                readonly "x-operation-id": components["parameters"]["OperationId"];
                /** @description Relay-only service credential; gateway credentials are never accepted. */
                readonly "x-relay-service-token": components["parameters"]["RelayServiceCredential"];
            };
            readonly path: {
                readonly transferId: components["parameters"]["TransferId"];
            };
            readonly cookie?: never;
        };
        readonly requestBody: components["requestBodies"]["RelayTransferProgressBody"];
        readonly responses: {
            readonly 200: components["responses"]["RelayTransferProgressSuccess"];
            readonly 400: components["responses"]["RelayInternalError"];
            readonly 401: components["responses"]["RelayInternalError"];
            readonly 403: components["responses"]["RelayInternalError"];
            readonly 404: components["responses"]["RelayInternalError"];
            readonly 409: components["responses"]["RelayInternalError"];
            readonly 503: components["responses"]["RelayInternalError"];
        };
    };
    readonly relayTransferResult: {
        readonly parameters: {
            readonly query?: never;
            readonly header: {
                readonly "x-correlation-id": components["parameters"]["CorrelationId"];
                readonly "x-operation-id": components["parameters"]["OperationId"];
                /** @description Relay-only service credential; gateway credentials are never accepted. */
                readonly "x-relay-service-token": components["parameters"]["RelayServiceCredential"];
            };
            readonly path: {
                readonly transferId: components["parameters"]["TransferId"];
            };
            readonly cookie?: never;
        };
        readonly requestBody: components["requestBodies"]["RelayTransferResultBody"];
        readonly responses: {
            readonly 200: components["responses"]["RelayTransferResultSuccess"];
            readonly 400: components["responses"]["RelayInternalError"];
            readonly 401: components["responses"]["RelayInternalError"];
            readonly 403: components["responses"]["RelayInternalError"];
            readonly 404: components["responses"]["RelayInternalError"];
            readonly 409: components["responses"]["RelayInternalError"];
            readonly 503: components["responses"]["RelayInternalError"];
        };
    };
    readonly relayTransferSourceUrl: {
        readonly parameters: {
            readonly query?: never;
            readonly header: {
                readonly "x-correlation-id": components["parameters"]["CorrelationId"];
                readonly "x-operation-id": components["parameters"]["OperationId"];
                /** @description Relay-only service credential; gateway credentials are never accepted. */
                readonly "x-relay-service-token": components["parameters"]["RelayServiceCredential"];
            };
            readonly path: {
                readonly transferId: components["parameters"]["TransferId"];
            };
            readonly cookie?: never;
        };
        readonly requestBody: components["requestBodies"]["RelayTransferSourceUrlBody"];
        readonly responses: {
            readonly 200: components["responses"]["RelayTransferSourceUrlSuccess"];
            readonly 400: components["responses"]["RelayInternalError"];
            readonly 401: components["responses"]["RelayInternalError"];
            readonly 403: components["responses"]["RelayInternalError"];
            readonly 404: components["responses"]["RelayInternalError"];
            readonly 409: components["responses"]["RelayInternalError"];
            readonly 503: components["responses"]["RelayInternalError"];
        };
    };
}
