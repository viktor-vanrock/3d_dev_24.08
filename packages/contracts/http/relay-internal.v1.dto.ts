import type { components, operations } from "./generated/relay-internal.v1.ts";

type JsonBody<T extends keyof components["requestBodies"]> = components["requestBodies"][T]["content"]["application/json"];
type JsonResponse<T extends keyof components["responses"]> = components["responses"][T]["content"]["application/json"];

export type RelayInternalErrorDto = components["schemas"]["RelayInternalErrorDto"];
export type RelayInternalErrorEnvelopeDto = components["schemas"]["RelayInternalErrorEnvelopeDto"];
export type RelayInternalErrorCode = components["schemas"]["RelayInternalErrorCode"];
export type RelayCommandStatus = components["schemas"]["RelayCommandStatus"];
export type RelayTerminalCommandStatus = components["schemas"]["RelayTerminalCommandStatus"];
export type RelayCommandPayloadDto = components["schemas"]["RelayCommandPayloadDto"];
export type RelayClaimedCommandDto = components["schemas"]["RelayClaimedCommandDto"];

export type RelaySessionAuthorizeHeadersDto = operations["relaySessionAuthorize"]["parameters"]["header"];
export type RelaySessionAuthorizeRequestDto = JsonBody<"RelaySessionAuthorizeBody">;
export type RelaySessionAuthorizeResponseDto = JsonResponse<"RelaySessionAuthorizeSuccess">;

export type RelaySessionHeartbeatHeadersDto = operations["relaySessionHeartbeat"]["parameters"]["header"];
export type RelaySessionHeartbeatPathDto = operations["relaySessionHeartbeat"]["parameters"]["path"];
export type RelaySessionHeartbeatRequestDto = JsonBody<"RelaySessionHeartbeatBody">;
export type RelaySessionHeartbeatResponseDto = JsonResponse<"RelaySessionHeartbeatSuccess">;

export type RelaySessionCloseHeadersDto = operations["relaySessionClose"]["parameters"]["header"];
export type RelaySessionClosePathDto = operations["relaySessionClose"]["parameters"]["path"];
export type RelaySessionCloseRequestDto = JsonBody<"RelaySessionCloseBody">;
export type RelaySessionCloseResponseDto = JsonResponse<"RelaySessionCloseSuccess">;

export type RelayGatewaysRevalidateHeadersDto = operations["relayGatewaysRevalidate"]["parameters"]["header"];
export type RelayGatewaysRevalidateRequestDto = JsonBody<"RelayGatewaysRevalidateBody">;
export type RelayGatewaysRevalidateResponseDto = JsonResponse<"RelayGatewaysRevalidateSuccess">;

export type RelayCommandsClaimHeadersDto = operations["relayCommandsClaim"]["parameters"]["header"];
export type RelayCommandsClaimRequestDto = JsonBody<"RelayCommandsClaimBody">;
export type RelayCommandsClaimResponseDto = JsonResponse<"RelayCommandsClaimSuccess">;

export type RelayCommandLeaseHeartbeatHeadersDto = operations["relayCommandLeaseHeartbeat"]["parameters"]["header"];
export type RelayCommandLeaseHeartbeatPathDto = operations["relayCommandLeaseHeartbeat"]["parameters"]["path"];
export type RelayCommandLeaseHeartbeatRequestDto = JsonBody<"RelayCommandLeaseHeartbeatBody">;
export type RelayCommandLeaseHeartbeatResponseDto = JsonResponse<"RelayCommandLeaseHeartbeatSuccess">;

export type RelayCommandResultHeadersDto = operations["relayCommandResult"]["parameters"]["header"];
export type RelayCommandResultPathDto = operations["relayCommandResult"]["parameters"]["path"];
export type RelayCommandResultRequestDto = JsonBody<"RelayCommandResultBody">;
export type RelayCommandResultResponseDto = JsonResponse<"RelayCommandResultSuccess">;

export type RelayTransferMetadataHeadersDto = operations["relayTransferMetadata"]["parameters"]["header"];
export type RelayTransferMetadataPathDto = operations["relayTransferMetadata"]["parameters"]["path"];
export type RelayTransferMetadataQueryDto = operations["relayTransferMetadata"]["parameters"]["query"];
export type RelayTransferMetadataResponseDto = JsonResponse<"RelayTransferMetadataSuccess">;

export type RelayTransferSourceUrlHeadersDto = operations["relayTransferSourceUrl"]["parameters"]["header"];
export type RelayTransferSourceUrlPathDto = operations["relayTransferSourceUrl"]["parameters"]["path"];
export type RelayTransferSourceUrlRequestDto = JsonBody<"RelayTransferSourceUrlBody">;
export type RelayTransferSourceUrlResponseDto = JsonResponse<"RelayTransferSourceUrlSuccess">;

export type RelayTransferProgressHeadersDto = operations["relayTransferProgress"]["parameters"]["header"];
export type RelayTransferProgressPathDto = operations["relayTransferProgress"]["parameters"]["path"];
export type RelayTransferProgressRequestDto = JsonBody<"RelayTransferProgressBody">;
export type RelayTransferProgressResponseDto = JsonResponse<"RelayTransferProgressSuccess">;

export type RelayTransferResultHeadersDto = operations["relayTransferResult"]["parameters"]["header"];
export type RelayTransferResultPathDto = operations["relayTransferResult"]["parameters"]["path"];
export type RelayTransferResultRequestDto = JsonBody<"RelayTransferResultBody">;
export type RelayTransferResultResponseDto = JsonResponse<"RelayTransferResultSuccess">;

export const RELAY_INTERNAL_V1_NAMED_DTOS = {
  relaySessionAuthorize: ["RelaySessionAuthorizeHeadersDto", "RelaySessionAuthorizeRequestDto", "RelaySessionAuthorizeResponseDto"],
  relaySessionHeartbeat: ["RelaySessionHeartbeatHeadersDto", "RelaySessionHeartbeatPathDto", "RelaySessionHeartbeatRequestDto", "RelaySessionHeartbeatResponseDto"],
  relaySessionClose: ["RelaySessionCloseHeadersDto", "RelaySessionClosePathDto", "RelaySessionCloseRequestDto", "RelaySessionCloseResponseDto"],
  relayGatewaysRevalidate: ["RelayGatewaysRevalidateHeadersDto", "RelayGatewaysRevalidateRequestDto", "RelayGatewaysRevalidateResponseDto"],
  relayCommandsClaim: ["RelayCommandsClaimHeadersDto", "RelayCommandsClaimRequestDto", "RelayCommandsClaimResponseDto"],
  relayCommandLeaseHeartbeat: ["RelayCommandLeaseHeartbeatHeadersDto", "RelayCommandLeaseHeartbeatPathDto", "RelayCommandLeaseHeartbeatRequestDto", "RelayCommandLeaseHeartbeatResponseDto"],
  relayCommandResult: ["RelayCommandResultHeadersDto", "RelayCommandResultPathDto", "RelayCommandResultRequestDto", "RelayCommandResultResponseDto"],
  relayTransferMetadata: ["RelayTransferMetadataHeadersDto", "RelayTransferMetadataPathDto", "RelayTransferMetadataQueryDto", "RelayTransferMetadataResponseDto"],
  relayTransferSourceUrl: ["RelayTransferSourceUrlHeadersDto", "RelayTransferSourceUrlPathDto", "RelayTransferSourceUrlRequestDto", "RelayTransferSourceUrlResponseDto"],
  relayTransferProgress: ["RelayTransferProgressHeadersDto", "RelayTransferProgressPathDto", "RelayTransferProgressRequestDto", "RelayTransferProgressResponseDto"],
  relayTransferResult: ["RelayTransferResultHeadersDto", "RelayTransferResultPathDto", "RelayTransferResultRequestDto", "RelayTransferResultResponseDto"],
} as const satisfies Readonly<Record<keyof operations, readonly string[]>>;
