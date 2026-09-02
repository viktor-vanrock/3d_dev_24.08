import { Body, Controller, Get, HttpCode, Inject, NotFoundException, Param, Post, Req, UnauthorizedException } from "@nestjs/common";
import { SESSION_USER, type RequestWithSession } from "../../../nest/auth/session-verifier.ts";
import { UserId, type UserId as UserIdType } from "../../_kernel/brandedIds.ts";
import { IMPORT_CONNECTIONS_PORT, type ImportConnectionsPort } from "../public/index.ts";
import { ApiImportConnectionsOperation } from "./openapi.ts";
import { User } from "../../permissions/public/index.ts";
import { ConnectImportAccountDto, ImportConnectionChallengeDto, ImportConnectionVerifyDto } from "./import-connections.dto.ts";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function user(request: RequestWithSession): UserIdType {
  const session = request[SESSION_USER];
  if (session === undefined) throw new UnauthorizedException();
  return UserId(session.id);
}

function connectionId(value: string): string {
  if (!UUID_RE.test(value)) throw new NotFoundException();
  return value;
}

@Controller("me/import-connections")
@User()
export class ImportConnectionsController {
  constructor(@Inject(IMPORT_CONNECTIONS_PORT) private readonly connections: ImportConnectionsPort) {}

  @Post()
  @ApiImportConnectionsOperation("Connect a Cults3D account", { status: 201, body: "connect", response: "connect" })
  connect(@Req() request: RequestWithSession, @Body() body: ConnectImportAccountDto | undefined) {
    return this.connections.connect(user(request), { sourcePlatform: body?.source_platform, username: body?.username, apiKey: body?.api_key });
  }

  @Get()
  @ApiImportConnectionsOperation("List own import connections and bindings")
  list(@Req() request: RequestWithSession) {
    return this.connections.list(user(request));
  }

  @Get(":id/models")
  @ApiImportConnectionsOperation("List models available from an import connection", { response: "models" })
  listModels(@Req() request: RequestWithSession, @Param("id") id: string) {
    return this.connections.listModels(user(request), connectionId(id));
  }

  @Post(":id/challenge")
  @ApiImportConnectionsOperation("Create an ownership challenge", { status: 201, body: "challenge", response: "challenge" })
  requestChallenge(@Req() request: RequestWithSession, @Param("id") id: string, @Body() body: ImportConnectionChallengeDto | undefined) {
    return this.connections.requestChallenge(user(request), connectionId(id), body?.target);
  }

  @Post(":id/verify")
  @HttpCode(200)
  @ApiImportConnectionsOperation("Verify an ownership challenge", { body: "verify", response: "verify" })
  verifyChallenge(@Req() request: RequestWithSession, @Param("id") id: string, @Body() body: ImportConnectionVerifyDto | undefined) {
    return this.connections.verifyChallenge(user(request), connectionId(id), body?.observed_text);
  }
}
