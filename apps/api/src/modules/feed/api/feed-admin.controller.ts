import { Body, Controller, Get, Inject, Param, ParseUUIDPipe, Patch, Post, Query, Req, UnauthorizedException } from "@nestjs/common";
import { FeedPostId, UserId } from "../../_kernel/brandedIds.ts";
import { SESSION_USER, type RequestWithSession } from "../../../nest/auth/session-verifier.ts";
import { Permission, Permissions } from "../../permissions/public/index.ts";
import { FEED_ADMIN_PORT, type FeedAdminPort } from "../public/index.ts";
import { ApiFeedOperation } from "./openapi.ts";
import { FeedAdminCreateDto, FeedAdminEnvelopeDto, FeedAdminListDto, FeedAdminQueryDto, FeedAdminUpdateDto } from "./feed-admin.dto.ts";

function actor(request: RequestWithSession) {
  const session = request[SESSION_USER];
  if (session === undefined) throw new UnauthorizedException();
  return UserId(session.id);
}

@Controller("data/news")
@Permission(Permissions.FEED_MANAGE_NEWS)
export class FeedAdminController {
  constructor(@Inject(FEED_ADMIN_PORT) private readonly admin: FeedAdminPort) {}

  @Get() @ApiFeedOperation("List managed news", { responseType: FeedAdminListDto })
  list(@Query() query: FeedAdminQueryDto) { return this.admin.list(query); }

  @Get(":id") @ApiFeedOperation("Read managed news", { responseType: FeedAdminEnvelopeDto })
  detail(@Param("id", new ParseUUIDPipe()) id: string) { return this.admin.detail(FeedPostId(id)); }

  @Post() @ApiFeedOperation("Create managed news draft", { status: 201, responseType: FeedAdminEnvelopeDto })
  create(@Req() request: RequestWithSession, @Body() body: FeedAdminCreateDto) { return this.admin.create(actor(request), body); }

  @Patch(":id") @ApiFeedOperation("Update managed news", { responseType: FeedAdminEnvelopeDto })
  update(@Req() request: RequestWithSession, @Param("id", new ParseUUIDPipe()) id: string, @Body() body: FeedAdminUpdateDto) { return this.admin.update(actor(request), FeedPostId(id), body); }

  @Post(":id/publish") @ApiFeedOperation("Publish managed news", { responseType: FeedAdminEnvelopeDto })
  publish(@Req() request: RequestWithSession, @Param("id", new ParseUUIDPipe()) id: string) { return this.admin.publish(actor(request), FeedPostId(id)); }

  @Post(":id/hide") @ApiFeedOperation("Hide managed news", { responseType: FeedAdminEnvelopeDto })
  hide(@Req() request: RequestWithSession, @Param("id", new ParseUUIDPipe()) id: string) { return this.admin.hide(actor(request), FeedPostId(id)); }
}
