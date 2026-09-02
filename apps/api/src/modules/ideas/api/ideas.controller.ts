import { Body, Controller, Get, Header, HttpCode, Inject, Param, Patch, Post, Query, Req, UnauthorizedException } from "@nestjs/common";
import { IdeaId, UserId, type UserId as UserIdType } from "../../_kernel/brandedIds.ts";
import { SESSION_USER, type RequestWithSession } from "../../../nest/auth/session-verifier.ts";
import { assertUuid } from "../application/ideas.service.ts";
import { IDEAS_PORT, type IdeasPort, type IdeasRateLimitIdentity } from "../public/index.ts";
import {
  CreateIdeaDto,
  EnrichIdeaDto,
  IdeaCommentDto,
  IdeasListQueryDto,
  IdeasMineQueryDto,
  IdeasSimilarQueryDto,
  IdeasTopQueryDto,
  IdeaStatusDto,
  IdeaCommentResponseDto,
  IdeaCommentsResponseDto,
  IdeaCreateResponseDto,
  IdeaDetailDto,
  IdeaEnrichmentResponseDto,
  IdeaModerationResponseDto,
  IdeasPageDto,
  IdeaSimilarResponseDto,
  IdeaStatusResponseDto,
  IdeaTopResponseDto,
  IdeaVoteResponseDto,
  ModerateIdeaDto,
} from "./ideas.dto.ts";
import { ApiIdeasOperation } from "./openapi.ts";
import { Permission } from "../../permissions/decorators/permission.decorator.ts";
import { Public } from "../../permissions/decorators/public.decorator.ts";
import { User } from "../../permissions/decorators/user.decorator.ts";
import { Permissions } from "../../permissions/domain/permissions.catalog.ts";

function optionalUser(request: RequestWithSession): UserIdType | null {
  const session = request[SESSION_USER];
  return session === undefined ? null : UserId(session.id);
}

function user(request: RequestWithSession): UserIdType {
  const value = optionalUser(request);
  if (value === null) throw new UnauthorizedException();
  return value;
}

function rateLimitIdentity(request: RequestWithSession): IdeasRateLimitIdentity {
  const rawAgent = request.headers["user-agent"];
  return {
    userId: user(request),
    ip: request.ip || null,
    userAgent: typeof rawAgent === "string" ? rawAgent : null,
  };
}

@Controller("ideas")
export class IdeasController {
  constructor(@Inject(IDEAS_PORT) private readonly ideas: IdeasPort) {}

  @Get()
  @Public()
  @ApiIdeasOperation("List ideas", IdeasPageDto)
  list(@Query() query: IdeasListQueryDto) {
    return this.ideas.list(query);
  }

  @Get("mine")
  @User()
  @ApiIdeasOperation("List the current user's ideas", IdeasPageDto, { auth: true })
  mine(@Req() request: RequestWithSession, @Query() query: IdeasMineQueryDto) {
    return this.ideas.mine(user(request), query);
  }

  @Get("top")
  @User()
  @Header("Cache-Control", "private, max-age=300")
  @ApiIdeasOperation("Read the top ideas digest", IdeaTopResponseDto, { auth: true })
  top(@Req() request: RequestWithSession, @Query() query: IdeasTopQueryDto) {
    return this.ideas.top(user(request), query);
  }

  @Get("similar")
  @User()
  @ApiIdeasOperation("Find similar idea titles", IdeaSimilarResponseDto, { auth: true })
  similar(@Req() request: RequestWithSession, @Query() query: IdeasSimilarQueryDto) {
    return this.ideas.similar(user(request), query.q);
  }

  @Get(":id/comments")
  @Public()
  @ApiIdeasOperation("List comments on an idea", IdeaCommentsResponseDto)
  comments(@Param("id") rawId: string, @Query() query: IdeasMineQueryDto) {
    return this.ideas.comments(assertUuid(rawId), query.cursor, query.limit);
  }

  @Post(":id/comments")
  @User()
  @ApiIdeasOperation("Comment on an idea", IdeaCommentResponseDto, { auth: true, created: true })
  comment(@Req() request: RequestWithSession, @Param("id") rawId: string, @Body() body: IdeaCommentDto) {
    return this.ideas.comment(user(request), assertUuid(rawId), body.body);
  }

  @Post(":id/vote")
  @User()
  @HttpCode(200)
  @ApiIdeasOperation("Toggle an idea vote", IdeaVoteResponseDto, { auth: true })
  vote(@Req() request: RequestWithSession, @Param("id") rawId: string) {
    return this.ideas.toggleVote(user(request), IdeaId(rawId));
  }

  @Patch(":id/status")
  @Permission(Permissions.MODERATION_DELETE_CONTENT)
  @ApiIdeasOperation("Change an idea status", IdeaStatusResponseDto, { auth: true })
  status(@Req() request: RequestWithSession, @Param("id") rawId: string, @Body() body: IdeaStatusDto) {
    return this.ideas.changeStatus(user(request), IdeaId(rawId), body);
  }

  @Post(":id/moderate")
  @Permission(Permissions.MODERATION_DELETE_CONTENT)
  @HttpCode(200)
  @ApiIdeasOperation("Moderate an idea", IdeaModerationResponseDto, { auth: true })
  moderate(@Req() request: RequestWithSession, @Param("id") rawId: string, @Body() body: ModerateIdeaDto) {
    return this.ideas.moderate(user(request), IdeaId(rawId), body);
  }

  @Get(":id")
  @Public()
  @ApiIdeasOperation("Read an idea detail", IdeaDetailDto)
  detail(@Req() request: RequestWithSession, @Param("id") rawId: string) {
    return this.ideas.detail(assertUuid(rawId), optionalUser(request));
  }

  @Post("enrich")
  @User()
  @HttpCode(200)
  @ApiIdeasOperation("Enrich an idea draft", IdeaEnrichmentResponseDto, { auth: true })
  enrich(@Req() request: RequestWithSession, @Body() body: EnrichIdeaDto) {
    const identity = rateLimitIdentity(request);
    return this.ideas.enrich(identity.userId, identity, body.free_text);
  }

  @Post()
  @User()
  @ApiIdeasOperation("Create an idea", IdeaCreateResponseDto, { auth: true, created: true })
  create(@Req() request: RequestWithSession, @Body() body: CreateIdeaDto) {
    const identity = rateLimitIdentity(request);
    return this.ideas.create(identity.userId, identity, body);
  }
}
