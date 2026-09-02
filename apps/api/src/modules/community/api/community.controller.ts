import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
  Res,
  UnprocessableEntityException,
  UploadedFile,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import type { Response } from "express";
import { SESSION_USER, type RequestWithSession } from "../../../nest/auth/session-verifier.ts";
import { UserId, type UserId as UserIdType } from "../../_kernel/brandedIds.ts";
import { COMMUNITY_PORT, type CommunityPort } from "../public/index.ts";
import { isUuid, SUBSCRIBE_SOURCES, type SubscribeSource } from "../domain/community.ts";
import { AcceptDto, BootstrapOwnerDto, CreateCommunityDto, CreatePostDto, CreateThreadDto, RoleDto, SubscriptionDto, VoteDto } from "./community.dto.ts";
import { ApiCommunityOperation } from "./openapi.ts";
import { COMMUNITY_STORAGE_PORT, type CommunityStoragePort } from "../application/community.ports.ts";
import { Permission } from "../../permissions/decorators/permission.decorator.ts";
import { Public } from "../../permissions/decorators/public.decorator.ts";
import { User } from "../../permissions/decorators/user.decorator.ts";
import { Permissions } from "../../permissions/domain/permissions.catalog.ts";
const uid = (r: RequestWithSession): UserIdType => UserId(r[SESSION_USER]!.id);
const id = (v: string) => {
  if (!isUuid(v)) throw new NotFoundException();
  return v;
};
const n = (v: string | undefined, d: number, max: number) => {
  const x = Number(v);
  return Number.isFinite(x) && x > 0 ? Math.min(Math.floor(x), max) : d;
};
const source = (v: unknown): SubscribeSource | null => (SUBSCRIBE_SOURCES.includes(v as SubscribeSource) ? (v as SubscribeSource) : null);
@Controller()
@User()
export class CommunityController {
  constructor(
    @Inject(COMMUNITY_PORT) private readonly community: CommunityPort,
    @Inject(COMMUNITY_STORAGE_PORT) private readonly storage: CommunityStoragePort,
  ) {}
  @Post("communities") @HttpCode(201) @ApiCommunityOperation("Create community", 201) create(@Req() r: RequestWithSession, @Body() b: CreateCommunityDto) {
    return this.community.create({
      name: b.name,
      slug: b.slug ?? "",
      description: b.description ?? null,
      visibility: b.visibility === "unlisted" ? "unlisted" : "public",
      tagIds: b.tag_ids ?? [],
      userId: uid(r),
    });
  }
  @Get("communities") @ApiCommunityOperation("List communities") list(
    @Req() r: RequestWithSession,
    @Query() q: { kind?: string; q?: string; member?: string; cursor?: string; limit?: string },
  ) {
    return this.community.list({ ...q, limit: n(q.limit, 24, 60), userId: uid(r) });
  }
  @Get("communities/:id") @ApiCommunityOperation("Community detail") detail(@Req() r: RequestWithSession, @Param("id") x: string) {
    return this.community.detail(x, uid(r));
  }
  @Post("communities/:id/join") @ApiCommunityOperation("Join community") join(@Req() r: RequestWithSession, @Param("id") x: string) {
    return this.community.join(id(x), uid(r));
  }
  @Post("communities/:id/leave") @ApiCommunityOperation("Leave community") leave(@Req() r: RequestWithSession, @Param("id") x: string) {
    return this.community.leave(id(x), uid(r));
  }
  @Post("communities/:id/subscribe") @ApiCommunityOperation("Subscribe") subscribe(
    @Req() r: RequestWithSession,
    @Param("id") x: string,
    @Body() b: SubscriptionDto,
    @Query("source") q?: string,
  ) {
    return this.community.subscribe(id(x), uid(r), source(b.source ?? q));
  }
  @Delete("communities/:id/subscribe") @ApiCommunityOperation("Unsubscribe") unsubscribe(
    @Req() r: RequestWithSession,
    @Param("id") x: string,
    @Body() b: SubscriptionDto,
    @Query("source") q?: string,
  ) {
    return this.community.unsubscribe(id(x), uid(r), source(b.source ?? q));
  }
  @Post("communities/:id/members/:userId/role") @ApiCommunityOperation("Set member role") role(
    @Req() r: RequestWithSession,
    @Param("id") x: string,
    @Param("userId") u: string,
    @Body() b: RoleDto,
  ) {
    return this.community.setRole(id(x), UserId(id(u)), uid(r), b.role);
  }
  @Post("communities/:id/bootstrap-owner") @Permission(Permissions.MODERATION_MANAGE_COMMUNITY_MEMBERS) @ApiCommunityOperation("Bootstrap owner") bootstrap(@Req() r: RequestWithSession, @Param("id") x: string, @Body() b: BootstrapOwnerDto) {
    return this.community.bootstrapOwner(id(x), UserId(b.user_id), uid(r));
  }
  @Get("communities/:id/feed") @Public() @ApiCommunityOperation("Community feed") feed(@Param("id") x: string, @Query() q: { sort?: string; cursor?: string; limit?: string }) {
    const sort = q.sort ?? "hot";
    if (!["hot", "new", "top"].includes(sort)) throw new UnprocessableEntityException();
    return this.community.feed(id(x), sort, n(q.limit, 24, 60), q.cursor ?? null);
  }
  @Post("communities/:id/threads") @HttpCode(201) @ApiCommunityOperation("Create thread", 201) createThread(
    @Req() r: RequestWithSession,
    @Param("id") x: string,
    @Body() b: CreateThreadDto,
  ) {
    return this.community.createThread(id(x), uid(r), { ...b, tags: b.tags ?? [] });
  }
  @Get("communities/:id/threads") @Public() @ApiCommunityOperation("List threads") threads(
    @Param("id") x: string,
    @Query() q: { type?: "discussion" | "question"; cursor?: string; limit?: string },
  ) {
    return this.community.threads({ communityId: id(x), ...q, limit: n(q.limit, 24, 60) });
  }
  @Get("threads/:id") @Public() @ApiCommunityOperation("Thread detail") thread(@Param("id") x: string) {
    return this.community.thread(id(x));
  }
  @Post("threads/:id/posts") @HttpCode(201) @ApiCommunityOperation("Create post", 201) post(@Req() r: RequestWithSession, @Param("id") x: string, @Body() b: CreatePostDto) {
    return this.community.createPost(id(x), uid(r), { kind: b.kind, content: b.content, ...(b.parent_post_id ? { parentPostId: b.parent_post_id } : {}) });
  }
  @Post("threads/:id/vote") @ApiCommunityOperation("Vote thread") voteThread(@Req() r: RequestWithSession, @Param("id") x: string, @Body() b: VoteDto) {
    return this.community.voteThread(id(x), uid(r), b.value);
  }
  @Post("posts/:id/vote") @ApiCommunityOperation("Vote post") votePost(@Req() r: RequestWithSession, @Param("id") x: string, @Body() b: VoteDto) {
    return this.community.votePost(id(x), uid(r), b.value);
  }
  @Post("posts/:id/attachments") @HttpCode(201) @UseInterceptors(FileInterceptor("file")) @ApiCommunityOperation("Upload attachment", 201) upload(
    @Req() r: RequestWithSession,
    @Param("id") x: string,
    @UploadedFile() f: { buffer: Buffer; originalname: string } | undefined,
  ) {
    if (!f) throw new NotFoundException();
    return this.community.uploadAttachment(id(x), uid(r), f);
  }
  @Get("posts/:id/attachments/:attachmentId") @Public() @ApiCommunityOperation("Download attachment") async attachment(
    @Param("id") p: string,
    @Param("attachmentId") a: string,
    @Res() res: Response,
  ) {
    const file = await this.community.attachment(id(p), id(a));
    const url = file.kind === "photo" ? this.storage.publicUrl(file.key) : null;
    if (url) {
      res.redirect(302, url);
      return;
    }
    const object = await this.storage.get(file.key);
    if (!object) throw new NotFoundException();
    res.type(file.kind === "model_3mf" ? "model/3mf" : "application/octet-stream").set("Cache-Control", "private, max-age=3600");
    if (object.etag) res.set("ETag", object.etag);
    if (object.contentLength !== undefined) res.set("Content-Length", String(object.contentLength));
    object.body.pipe(res);
  }
  @Post("threads/:id/accept") @ApiCommunityOperation("Accept answer") accept(@Req() r: RequestWithSession, @Param("id") x: string, @Body() b: AcceptDto) {
    return this.community.accept(id(x), uid(r), b.post_id ?? null);
  }
}
