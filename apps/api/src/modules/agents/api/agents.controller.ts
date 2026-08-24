import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query, Req, UnauthorizedException } from "@nestjs/common";
import { SESSION_USER, type RequestWithSession } from "../../../nest/auth/session-verifier.ts";
import { getRequestId, type RequestWithId } from "../../../nest/observability/request-id.ts";
import { UserId } from "../../_kernel/brandedIds.ts";
import { AGENTS_PORT, type AgentsPort } from "../public/index.ts";
import { AgentAccountResponseDto, AgentBodyDto, AgentKeyListResponseDto, AgentListResponseDto, MintedAgentContentKeyDto } from "./agents.dto.ts";
import { ApiAgentsOperation } from "./openapi.ts";

function session(request: RequestWithSession) {
  const value = request[SESSION_USER];
  if (value === undefined) throw new UnauthorizedException();
  return { id: UserId(value.id), username: value.username };
}
function context(request: RequestWithId) {
  return { request, requestId: getRequestId(request) };
}

@Controller()
export class AgentsController {
  constructor(@Inject(AGENTS_PORT) private readonly agents: AgentsPort) {}

  @Post("me/agents")
  @ApiAgentsOperation("Create content agent", 201, AgentAccountResponseDto)
  create(@Req() request: RequestWithSession & RequestWithId, @Body() body: AgentBodyDto) {
    return this.agents.create(session(request), { ...body }, context(request));
  }

  @Get("me/agents")
  @ApiAgentsOperation("List content agents", 200, AgentListResponseDto)
  list(@Req() request: RequestWithSession & RequestWithId, @Query() query: { limit?: string; offset?: string }) {
    return this.agents.list(session(request).id, query, context(request));
  }

  @Post("me/agents/:id/revoke")
  @HttpCode(200)
  @ApiAgentsOperation("Revoke content agent", 200, AgentAccountResponseDto)
  revoke(@Req() request: RequestWithSession & RequestWithId, @Param("id") id: string) {
    return this.agents.revoke(session(request).id, id, context(request));
  }

  @Post("me/agents/:id/keys")
  @ApiAgentsOperation("Create agent content key", 201, MintedAgentContentKeyDto)
  mint(@Req() request: RequestWithSession & RequestWithId, @Param("id") id: string, @Body() body: AgentBodyDto) {
    return this.agents.mintKey(session(request).id, id, body.label, context(request));
  }

  @Get("me/agents/:id/keys")
  @ApiAgentsOperation("List agent content keys", 200, AgentKeyListResponseDto)
  keys(@Req() request: RequestWithSession & RequestWithId, @Param("id") id: string) {
    return this.agents.listKeys(session(request).id, id, context(request));
  }

  @Post("me/agents/:id/keys/:keyId/revoke")
  @HttpCode(204)
  @ApiAgentsOperation("Revoke agent content key", 204)
  revokeKey(@Req() request: RequestWithSession & RequestWithId, @Param("id") id: string, @Param("keyId") keyId: string) {
    return this.agents.revokeKey(session(request).id, id, keyId, context(request));
  }
}
