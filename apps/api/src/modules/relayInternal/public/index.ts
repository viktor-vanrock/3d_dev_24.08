import type {
  RelayGatewaysRevalidateRequestDto,
  RelayGatewaysRevalidateResponseDto,
  RelaySessionAuthorizeRequestDto,
  RelaySessionAuthorizeResponseDto,
  RelaySessionCloseRequestDto,
  RelaySessionCloseResponseDto,
  RelaySessionHeartbeatRequestDto,
  RelaySessionHeartbeatResponseDto,
  RelayTransferMetadataResponseDto,
  RelayTransferProgressRequestDto,
  RelayTransferProgressResponseDto,
  RelayTransferResultRequestDto,
  RelayTransferResultResponseDto,
} from "@portal/contracts/http/relay-internal.v1.dto";

export const RELAY_CONTROL_PORT = Symbol("RELAY_CONTROL_PORT");

export interface RelayCommandClaimAuthorization {
  readonly gatewayId: string;
  readonly ownerId: string;
  readonly authorizationRevision: number;
  readonly authorizedDeviceIds: readonly string[];
}

export interface RelayTransferSourceTuple {
  readonly objectKey: string;
  readonly objectVersion: string;
  readonly sha256: string;
  readonly sizeBytes: number;
  readonly contentType: RelayTransferMetadataResponseDto["content_type"];
  readonly metadata: RelayTransferMetadataResponseDto;
}

export interface RelayControlPort {
  authorizeSession(input: {
    readonly operationId: string;
    readonly requestHash: string;
    readonly connectionId: string;
    readonly request: RelaySessionAuthorizeRequestDto;
  }): Promise<RelaySessionAuthorizeResponseDto>;

  heartbeatSession(input: {
    readonly operationId: string;
    readonly requestHash: string;
    readonly sessionId: string;
    readonly request: RelaySessionHeartbeatRequestDto;
  }): Promise<RelaySessionHeartbeatResponseDto>;

  closeSession(input: {
    readonly operationId: string;
    readonly requestHash: string;
    readonly sessionId: string;
    readonly request: RelaySessionCloseRequestDto;
  }): Promise<RelaySessionCloseResponseDto>;

  revalidateGateways(request: RelayGatewaysRevalidateRequestDto): Promise<RelayGatewaysRevalidateResponseDto>;

  authorizeCommandSession(input: {
    readonly sessionId: string;
    readonly gatewayId: string;
    readonly sessionGeneration: number;
    readonly authorizationRevision: number;
  }): Promise<RelayCommandClaimAuthorization>;

  getTransferMetadata(input: { readonly transferId: string; readonly sessionId: string; readonly sessionGeneration: number }): Promise<RelayTransferMetadataResponseDto>;

  getTransferSourceTuple(input: {
    readonly transferId: string;
    readonly sessionId: string;
    readonly sessionGeneration: number;
    readonly objectVersion?: string;
    readonly sha256?: string;
    readonly sizeBytes?: number;
  }): Promise<RelayTransferSourceTuple>;

  writeTransferProgress(input: {
    readonly operationId: string;
    readonly requestHash: string;
    readonly transferId: string;
    readonly request: RelayTransferProgressRequestDto;
  }): Promise<RelayTransferProgressResponseDto>;

  writeTransferResult(input: {
    readonly operationId: string;
    readonly requestHash: string;
    readonly transferId: string;
    readonly request: RelayTransferResultRequestDto;
  }): Promise<RelayTransferResultResponseDto>;
}
