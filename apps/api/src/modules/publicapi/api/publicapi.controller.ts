import { Body, Controller, Delete, Get, Headers, HttpCode, Inject, Param, Post, Query, Req, Res, UnauthorizedException } from "@nestjs/common";
import type { Response } from "express";
import { SESSION_USER, type RequestWithSession } from "../../../nest/auth/session-verifier.ts";
import { getRequestId, type RequestWithId } from "../../../nest/observability/request-id.ts";
import { UserId, type UserId as UserIdType } from "../../_kernel/brandedIds.ts";
import { PUBLICAPI_DEVICES_PORT, PUBLICAPI_PORT, type PublicApiDevicesPort, type PublicApiKeyScope, type PublicApiPort } from "../public/index.ts";
import {
  PublicApiKeyBodyDto,
  PublicApiKeyListDto,
  PublicApiKeySecretDto,
  PublicCommandStatusDto,
  PublicDeviceCommandDto,
  PublicPrinterDto,
  PublicPrinterListDto,
  PublicQueuedCommandDto,
  PublicTelemetryDto,
  PublicTestQueryDto,
  UserApiKeyListDto,
  UserApiKeySecretDto,
} from "./publicapi.dto.ts";
import { ApiPublicApiOperation } from "./openapi.ts";
import { Internal, User } from "../../permissions/public/index.ts";
function user(request: RequestWithSession): UserIdType {
  const value = request[SESSION_USER];
  if (value === undefined) throw new UnauthorizedException();
  return UserId(value.id);
}
function context(request: RequestWithId) {
  return { request, requestId: getRequestId(request) };
}
@Controller()
@User()
export class PublicApiController {
  constructor(
    @Inject(PUBLICAPI_PORT) private readonly api: PublicApiPort,
    @Inject(PUBLICAPI_DEVICES_PORT) private readonly devices: PublicApiDevicesPort,
  ) {}
  @Post("me/api-keys") @ApiPublicApiOperation("Create printer API key", { session: true, status: 201, responseType: PublicApiKeySecretDto }) create(
    @Req() r: RequestWithSession & RequestWithId,
    @Body() b: PublicApiKeyBodyDto,
  ) {
    return this.api.createApiKey(user(r), { ...b }, context(r));
  }
  @Get("me/api-keys") @ApiPublicApiOperation("List printer API keys", { session: true, responseType: PublicApiKeyListDto }) list(@Req() r: RequestWithSession & RequestWithId) {
    return this.api.listApiKeys(user(r), context(r));
  }
  @Delete("me/api-keys/:id") @HttpCode(204) @ApiPublicApiOperation("Revoke printer API key", { session: true, status: 204 }) revoke(
    @Req() r: RequestWithSession & RequestWithId,
    @Param("id") id: string,
  ) {
    return this.api.revokeApiKey(user(r), id, context(r));
  }
  @Post("me/api-keys/:id/rotate") @ApiPublicApiOperation("Rotate printer API key", { session: true, status: 201, responseType: PublicApiKeySecretDto }) rotate(
    @Req() r: RequestWithSession & RequestWithId,
    @Param("id") id: string,
    @Body() b: PublicApiKeyBodyDto,
  ) {
    return this.api.rotateApiKey(user(r), id, { ...b }, context(r));
  }
  @Post("me/user-api-keys") @ApiPublicApiOperation("Create user API key", { session: true, status: 201, responseType: UserApiKeySecretDto }) createUser(
    @Req() r: RequestWithSession & RequestWithId,
    @Body() b: PublicApiKeyBodyDto,
  ) {
    return this.api.createUserApiKey(user(r), { ...b }, context(r));
  }
  @Get("me/user-api-keys") @ApiPublicApiOperation("List user API keys", { session: true, responseType: UserApiKeyListDto }) listUser(
    @Req() r: RequestWithSession & RequestWithId,
    @Query() q: { limit?: string; offset?: string; scope?: string },
  ) {
    return this.api.listUserApiKeys(user(r), q, context(r));
  }
  @Delete("me/user-api-keys/:id") @HttpCode(204) @ApiPublicApiOperation("Revoke user API key", { session: true, status: 204 }) revokeUser(
    @Req() r: RequestWithSession & RequestWithId,
    @Param("id") id: string,
  ) {
    return this.api.revokeUserApiKey(user(r), id, context(r));
  }

  private async principal(r: RequestWithId, scope: PublicApiKeyScope) {
    return this.api.authenticate(r.headers.authorization, scope, context(r));
  }
  @Get("v0/printers") @Internal() @ApiPublicApiOperation("List printers", { bearer: true, responseType: PublicPrinterListDto }) async printers(@Req() r: RequestWithId) {
    return this.devices.listPrinters((await this.principal(r, "read")).ownerId);
  }
  @Get("v0/printers/:id") @Internal() @ApiPublicApiOperation("Read printer", { bearer: true, responseType: PublicPrinterDto }) async printer(@Req() r: RequestWithId, @Param("id") id: string) {
    return this.devices.printer((await this.principal(r, "read")).ownerId, id);
  }
  @Get("v0/printers/:id/telemetry") @Internal() @ApiPublicApiOperation("Read printer telemetry", { bearer: true, responseType: PublicTelemetryDto }) async telemetry(
    @Req() r: RequestWithId,
    @Param("id") id: string,
    @Query() q: { limit?: string; since?: string },
  ) {
    return this.devices.telemetry((await this.principal(r, "read")).ownerId, id, q);
  }
  @Post("v0/printers/:id/test-job/commands")
  @Internal()
  @ApiPublicApiOperation("Run safe printer test command", {
    bearer: true,
    status: 202,
    responseType: PublicQueuedCommandDto,
    additionalSuccess: [200],
    additionalResponseType: PublicTestQueryDto,
  })
  async test(
    @Req() r: RequestWithId,
    @Res({ passthrough: true }) res: Response,
    @Param("id") id: string,
    @Headers("idempotency-key") key: unknown,
    @Body() b: PublicDeviceCommandDto,
  ) {
    const p = await this.principal(r, "control");
    const out = await this.devices.testJobCommand(p.ownerId, id, { ...b }, key, getRequestId(r));
    res.status(out.status);
    return out.body;
  }
  @Post("v0/printers/:id/commands") @Internal() @ApiPublicApiOperation("Queue printer command", { bearer: true, status: 202, responseType: PublicQueuedCommandDto }) async command(
    @Req() r: RequestWithId,
    @Res({ passthrough: true }) res: Response,
    @Param("id") id: string,
    @Headers("idempotency-key") key: unknown,
    @Body() b: PublicDeviceCommandDto,
  ) {
    const p = await this.principal(r, "control");
    const out = await this.devices.command(p.ownerId, id, { ...b }, key, getRequestId(r), p.scopes.includes("control"));
    res.status(out.status);
    return out.body;
  }
  @Get("v0/printers/:id/commands/:commandId") @Internal() @ApiPublicApiOperation("Read printer command", { bearer: true, responseType: PublicCommandStatusDto }) async commandStatus(
    @Req() r: RequestWithId,
    @Param("id") id: string,
    @Param("commandId") commandId: string,
  ) {
    return this.devices.commandStatus((await this.principal(r, "read")).ownerId, id, commandId);
  }
}
