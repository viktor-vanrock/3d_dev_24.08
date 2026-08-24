import { HttpStatus, Inject, Injectable } from "@nestjs/common";
import type {
  RelayCommandLeaseHeartbeatRequestDto,
  RelayCommandLeaseHeartbeatResponseDto,
  RelayCommandResultRequestDto,
  RelayCommandResultResponseDto,
  RelayCommandsClaimRequestDto,
  RelayCommandsClaimResponseDto,
  RelayGatewaysRevalidateRequestDto,
  RelayGatewaysRevalidateResponseDto,
  RelaySessionAuthorizeRequestDto,
  RelaySessionAuthorizeResponseDto,
  RelaySessionCloseRequestDto,
  RelaySessionCloseResponseDto,
  RelaySessionHeartbeatRequestDto,
  RelaySessionHeartbeatResponseDto,
  RelayTransferMetadataQueryDto,
  RelayTransferMetadataResponseDto,
  RelayTransferProgressRequestDto,
  RelayTransferProgressResponseDto,
  RelayTransferResultRequestDto,
  RelayTransferResultResponseDto,
  RelayTransferSourceUrlRequestDto,
  RelayTransferSourceUrlResponseDto,
} from "@portal/contracts/http/relay-internal.v1.dto";
import { getDeviceTransferObjectPresignedUrl } from "../../../storage/s3.ts";
import { canonicalRequestHash } from "../../_kernel/canonical-request-hash.ts";
import { DEVICE_COMMAND_RELAY_PORT, issueCommandToken, type DeviceCommandRelayPort } from "../../devices/public/index.ts";
import { RelayInternalException } from "../domain/relay-internal.error.ts";
import { RELAY_CONTROL_PORT, type RelayControlPort } from "../public/index.ts";

function repositoryError(error: unknown): RelayInternalException | null {
  if (typeof error !== "object" || error === null || !("code" in error)) return null;
  const code = error.code;
  if (typeof code !== "string") return null;
  switch (code) {
    case "gateway_forbidden":
      return new RelayInternalException(HttpStatus.FORBIDDEN, "relay.auth.gateway_forbidden.v1", "Gateway is not authorized");
    case "session_not_found":
      return new RelayInternalException(HttpStatus.NOT_FOUND, "relay.session.not_found.v1", "Relay session was not found");
    case "session_conflict":
      return new RelayInternalException(HttpStatus.CONFLICT, "relay.session.conflict.v1", "Relay session is no longer current");
    case "transfer_not_found":
      return new RelayInternalException(HttpStatus.NOT_FOUND, "relay.transfer.not_found.v1", "Transfer was not found");
    case "source_changed":
      return new RelayInternalException(HttpStatus.CONFLICT, "relay.transfer.source_changed.v1", "Transfer source changed");
    case "idempotency_conflict":
    case "transfer_conflict":
      return new RelayInternalException(HttpStatus.CONFLICT, "relay.idempotency.conflict.v1", "Operation conflicts with an earlier request");
    default:
      return null;
  }
}

@Injectable()
export class RelayInternalService {
  constructor(
    @Inject(RELAY_CONTROL_PORT) private readonly control: RelayControlPort,
    @Inject(DEVICE_COMMAND_RELAY_PORT) private readonly commands: DeviceCommandRelayPort,
  ) {}

  async authorizeSession(operationId: string, request: RelaySessionAuthorizeRequestDto): Promise<RelaySessionAuthorizeResponseDto> {
    try {
      return await this.control.authorizeSession({ operationId, requestHash: canonicalRequestHash(request), connectionId: operationId, request });
    } catch (error) {
      throw repositoryError(error) ?? error;
    }
  }

  async heartbeatSession(operationId: string, sessionId: string, request: RelaySessionHeartbeatRequestDto): Promise<RelaySessionHeartbeatResponseDto> {
    try {
      return await this.control.heartbeatSession({ operationId, requestHash: canonicalRequestHash(request), sessionId, request });
    } catch (error) {
      throw repositoryError(error) ?? error;
    }
  }

  async closeSession(operationId: string, sessionId: string, request: RelaySessionCloseRequestDto): Promise<RelaySessionCloseResponseDto> {
    try {
      return await this.control.closeSession({ operationId, requestHash: canonicalRequestHash(request), sessionId, request });
    } catch (error) {
      throw repositoryError(error) ?? error;
    }
  }

  revalidateGateways(request: RelayGatewaysRevalidateRequestDto): Promise<RelayGatewaysRevalidateResponseDto> {
    return this.control.revalidateGateways(request);
  }

  async claimCommands(operationId: string, request: RelayCommandsClaimRequestDto): Promise<RelayCommandsClaimResponseDto> {
    let authorization;
    try {
      authorization = await this.control.authorizeCommandSession({
        sessionId: request.session_id,
        gatewayId: request.gateway_id,
        sessionGeneration: request.session_generation,
        authorizationRevision: request.authorization_revision,
      });
    } catch (error) {
      throw repositoryError(error) ?? error;
    }
    const claim = await this.commands.claim({
      claimOwner: request.claim_owner,
      authorizedDeviceIds: authorization.authorizedDeviceIds,
      limit: request.limit,
      operationId,
      requestHash: canonicalRequestHash(request),
    });
    const commands = await Promise.all(
      claim.commands.map(async (row) => {
        const issued = await issueCommandToken({
          commandId: row.commandId,
          gatewayId: authorization.gatewayId,
          ownerId: authorization.ownerId,
          actorId: row.actorId,
          deviceId: row.deviceId,
          role: row.actorRole,
          command: row.command,
          seq: row.commandSeq,
        });
        return {
          command_id: row.commandId,
          device_id: row.deviceId,
          command_seq: row.commandSeq,
          status: "leased" as const,
          payload: {
            command: row.command,
            ...(row.fileName === null ? {} : { file_name: row.fileName }),
          },
          command_token: issued.token,
          claim_owner: row.claimOwner,
          claim_token: row.claimToken,
          generation: row.generation,
          attempt_count: row.attemptCount,
          max_attempts: row.maxAttempts,
          lease_expires_at: row.leaseExpiresAt.toISOString(),
          expires_at: row.expiresAt.toISOString(),
        };
      }),
    );
    return { claim_owner: request.claim_owner, commands, claimed_at: new Date().toISOString(), replayed: claim.replayed };
  }

  async heartbeatCommand(commandId: string, request: RelayCommandLeaseHeartbeatRequestDto): Promise<RelayCommandLeaseHeartbeatResponseDto> {
    const row = await this.commands.heartbeat({
      commandId,
      claimOwner: request.claim_owner,
      claimToken: request.claim_token,
      generation: request.generation,
      deliveryState: request.delivery_state,
    });
    if (row === null) {
      throw new RelayInternalException(HttpStatus.CONFLICT, "relay.command.fence_conflict.v1", "Command lease is no longer current");
    }
    return {
      command_id: row.commandId,
      status: row.status,
      generation: row.generation,
      lease_expires_at: row.leaseExpiresAt.toISOString(),
      replayed: false,
    };
  }

  async writeCommandResult(commandId: string, request: RelayCommandResultRequestDto): Promise<RelayCommandResultResponseDto> {
    const result = await this.commands.writeResult({
      commandId,
      commandSeq: request.command_seq,
      claimOwner: request.claim_owner,
      claimToken: request.claim_token,
      generation: request.generation,
      status: request.status,
      errorCode: request.error_code ?? null,
    });
    if (result.kind === "fence_rejected") {
      throw new RelayInternalException(HttpStatus.CONFLICT, "relay.command.fence_conflict.v1", "Command fence is no longer current");
    }
    if (result.kind === "conflict") {
      throw new RelayInternalException(HttpStatus.CONFLICT, "relay.command.result_conflict.v1", "Command already has a different terminal result");
    }
    if (!("row" in result)) {
      throw new RelayInternalException(HttpStatus.CONFLICT, "relay.command.result_conflict.v1", "Command result was not accepted");
    }
    return {
      command_id: result.row.commandId,
      command_seq: result.row.commandSeq,
      status: result.row.status,
      generation: result.row.generation,
      persisted_at: result.row.completedAt.toISOString(),
      replayed: result.kind === "replayed",
    };
  }

  async transferMetadata(transferId: string, query: RelayTransferMetadataQueryDto): Promise<RelayTransferMetadataResponseDto> {
    try {
      return await this.control.getTransferMetadata({ transferId, sessionId: query.session_id, sessionGeneration: Number(query.session_generation) });
    } catch (error) {
      throw repositoryError(error) ?? error;
    }
  }

  async transferSourceUrl(_operationId: string, transferId: string, request: RelayTransferSourceUrlRequestDto): Promise<RelayTransferSourceUrlResponseDto> {
    try {
      const tuple = await this.control.getTransferSourceTuple({
        transferId,
        sessionId: request.session_id,
        sessionGeneration: request.session_generation,
        objectVersion: request.object_version,
        sha256: request.sha256,
        sizeBytes: request.size_bytes,
      });
      const ttlSeconds = 300;
      const issuedAt = Date.now();
      const sourceUrl = await getDeviceTransferObjectPresignedUrl(tuple.objectKey, tuple.objectVersion, ttlSeconds);
      if (sourceUrl === null || !sourceUrl.startsWith("https://")) {
        throw new RelayInternalException(HttpStatus.SERVICE_UNAVAILABLE, "relay.service_unavailable.v1", "Transfer source is temporarily unavailable", true);
      }
      return {
        transfer_id: tuple.metadata.transfer_id,
        source_url: sourceUrl,
        expires_at: new Date(issuedAt + ttlSeconds * 1000).toISOString(),
        range_supported: true,
        size_bytes: tuple.sizeBytes,
        sha256: tuple.sha256,
        object_version: tuple.objectVersion,
        next_offset: tuple.metadata.next_offset,
        next_sequence: tuple.metadata.next_sequence,
      };
    } catch (error) {
      if (error instanceof RelayInternalException) throw error;
      throw repositoryError(error) ?? error;
    }
  }

  async transferProgress(operationId: string, transferId: string, request: RelayTransferProgressRequestDto): Promise<RelayTransferProgressResponseDto> {
    try {
      return await this.control.writeTransferProgress({ operationId, requestHash: canonicalRequestHash(request), transferId, request });
    } catch (error) {
      throw repositoryError(error) ?? error;
    }
  }

  async transferResult(operationId: string, transferId: string, request: RelayTransferResultRequestDto): Promise<RelayTransferResultResponseDto> {
    try {
      return await this.control.writeTransferResult({ operationId, requestHash: canonicalRequestHash(request), transferId, request });
    } catch (error) {
      throw repositoryError(error) ?? error;
    }
  }
}
