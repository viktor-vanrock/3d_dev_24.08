import { Controller, Get, Headers, HttpCode, HttpStatus, Inject, Post, Put, UseFilters, UseGuards } from "@nestjs/common";
import { ApiExcludeController, ApiOperation, ApiSecurity, ApiTags } from "@nestjs/swagger";
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
import { RelayInternalService } from "../application/relay-internal.service.ts";
import { RelayInternalExceptionFilter } from "./relay-internal.filter.ts";
import { RelayBody, RelayParam, RelayQuery } from "./relay-internal.validation.ts";
import { RelayServiceGuard } from "./relay-service.guard.ts";
import { Internal } from "../../permissions/public/index.ts";

@Controller("internal/relay/v1")
@Internal()
@ApiTags("relay-internal-v1")
@ApiSecurity("relayServiceCredential")
@ApiExcludeController()
@UseGuards(RelayServiceGuard)
@UseFilters(RelayInternalExceptionFilter)
export class RelayInternalController {
  constructor(@Inject(RelayInternalService) private readonly service: RelayInternalService) {}

  @Post("sessions/authorize")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ operationId: "relaySessionAuthorize" })
  authorizeSession(
    @Headers("x-operation-id") operationId: string,
    @RelayBody("RelaySessionAuthorizeRequestDto") body: RelaySessionAuthorizeRequestDto,
  ): Promise<RelaySessionAuthorizeResponseDto> {
    return this.service.authorizeSession(operationId, body);
  }

  @Post("sessions/:sessionId/heartbeat")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ operationId: "relaySessionHeartbeat" })
  heartbeatSession(
    @Headers("x-operation-id") operationId: string,
    @RelayParam("sessionId") sessionId: string,
    @RelayBody("RelaySessionHeartbeatRequestDto") body: RelaySessionHeartbeatRequestDto,
  ): Promise<RelaySessionHeartbeatResponseDto> {
    return this.service.heartbeatSession(operationId, sessionId, body);
  }

  @Post("sessions/:sessionId/close")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ operationId: "relaySessionClose" })
  closeSession(
    @Headers("x-operation-id") operationId: string,
    @RelayParam("sessionId") sessionId: string,
    @RelayBody("RelaySessionCloseRequestDto") body: RelaySessionCloseRequestDto,
  ): Promise<RelaySessionCloseResponseDto> {
    return this.service.closeSession(operationId, sessionId, body);
  }

  @Post("gateways/revalidate")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ operationId: "relayGatewaysRevalidate" })
  revalidateGateways(@RelayBody("RelayGatewaysRevalidateRequestDto") body: RelayGatewaysRevalidateRequestDto): Promise<RelayGatewaysRevalidateResponseDto> {
    return this.service.revalidateGateways(body);
  }

  @Post("commands/claim")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ operationId: "relayCommandsClaim" })
  claimCommands(
    @Headers("x-operation-id") operationId: string,
    @RelayBody("RelayCommandsClaimRequestDto") body: RelayCommandsClaimRequestDto,
  ): Promise<RelayCommandsClaimResponseDto> {
    return this.service.claimCommands(operationId, body);
  }

  @Post("commands/:commandId/lease-heartbeat")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ operationId: "relayCommandLeaseHeartbeat" })
  heartbeatCommand(
    @RelayParam("commandId") commandId: string,
    @RelayBody("RelayCommandLeaseHeartbeatRequestDto") body: RelayCommandLeaseHeartbeatRequestDto,
  ): Promise<RelayCommandLeaseHeartbeatResponseDto> {
    return this.service.heartbeatCommand(commandId, body);
  }

  @Put("commands/:commandId/result")
  @ApiOperation({ operationId: "relayCommandResult" })
  writeCommandResult(
    @RelayParam("commandId") commandId: string,
    @RelayBody("RelayCommandResultRequestDto") body: RelayCommandResultRequestDto,
  ): Promise<RelayCommandResultResponseDto> {
    return this.service.writeCommandResult(commandId, body);
  }

  @Get("transfers/:transferId/metadata")
  @ApiOperation({ operationId: "relayTransferMetadata" })
  transferMetadata(
    @RelayParam("transferId") transferId: string,
    @RelayQuery("RelayTransferMetadataQueryDto") query: RelayTransferMetadataQueryDto,
  ): Promise<RelayTransferMetadataResponseDto> {
    return this.service.transferMetadata(transferId, query);
  }

  @Post("transfers/:transferId/source-url")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ operationId: "relayTransferSourceUrl" })
  transferSourceUrl(
    @Headers("x-operation-id") operationId: string,
    @RelayParam("transferId") transferId: string,
    @RelayBody("RelayTransferSourceUrlRequestDto") body: RelayTransferSourceUrlRequestDto,
  ): Promise<RelayTransferSourceUrlResponseDto> {
    return this.service.transferSourceUrl(operationId, transferId, body);
  }

  @Put("transfers/:transferId/progress")
  @ApiOperation({ operationId: "relayTransferProgress" })
  transferProgress(
    @Headers("x-operation-id") operationId: string,
    @RelayParam("transferId") transferId: string,
    @RelayBody("RelayTransferProgressRequestDto") body: RelayTransferProgressRequestDto,
  ): Promise<RelayTransferProgressResponseDto> {
    return this.service.transferProgress(operationId, transferId, body);
  }

  @Put("transfers/:transferId/result")
  @ApiOperation({ operationId: "relayTransferResult" })
  transferResult(
    @Headers("x-operation-id") operationId: string,
    @RelayParam("transferId") transferId: string,
    @RelayBody("RelayTransferResultRequestDto") body: RelayTransferResultRequestDto,
  ): Promise<RelayTransferResultResponseDto> {
    return this.service.transferResult(operationId, transferId, body);
  }
}
