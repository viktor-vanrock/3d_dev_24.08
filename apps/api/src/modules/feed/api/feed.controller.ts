import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UnauthorizedException,
  UploadedFile,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import type { Request, Response } from "express";
import { SessionVerifier, SESSION_USER, type RequestWithSession } from "../../../nest/auth/session-verifier.ts";
import { CommentId, FeedPostId, UserId } from "../../_kernel/brandedIds.ts";
import {
  FEED_AGENT_AUTH_PORT,
  FEED_INGEST_AUTH_PORT,
  FEED_PORT,
  type FeedActor,
  type FeedAgentAuthPort,
  type FeedAsset,
  type FeedIngestAuthPort,
  type FeedPort,
} from "../public/index.ts";
import {
  FeedCommentBodyDto,
  FeedCommentsQueryDto,
  FeedEventBodyDto,
  FeedGitverseQueryDto,
  FeedListQueryDto,
  FeedPatchDto,
  FeedPostBodyDto,
  FeedVoteBodyDto,
  FeedCommentEnvelopeDto,
  FeedCommentsResponseDto,
  FeedGitverseMetaDto,
  FeedImageUploadResponseDto,
  FeedMediaUploadResponseDto,
  FeedOkDto,
  FeedPageResponseDto,
  FeedPostEnvelopeDto,
  FeedSavedResponseDto,
  FeedVoteResponseDto,
} from "./feed.dto.ts";
import { ApiFeedOperation, ApiFeedUpload } from "./openapi.ts";
import { Internal, Public, User, UserOrAgent } from "../../permissions/public/index.ts";

const MAX_FEED_VIDEO_BYTES = 200 * 1024 * 1024;
const MAX_FEED_IMAGE_BYTES = 15 * 1024 * 1024;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface UploadedFeedFile {
  readonly buffer: Buffer;
}

function bearer(header: string | undefined): string | null {
  return header === undefined ? null : (/^Bearer (\S+)$/.exec(header)?.[1] ?? null);
}

function postId(value: string) {
  if (!UUID_RE.test(value)) throw new NotFoundException();
  return FeedPostId(value);
}

function commentId(value: string) {
  if (!UUID_RE.test(value)) throw new NotFoundException();
  return CommentId(value);
}

@Controller("feed")
export class FeedController {
  constructor(
    @Inject(FEED_PORT) private readonly feed: FeedPort,
    @Inject(SessionVerifier) private readonly sessions: SessionVerifier,
    @Inject(FEED_AGENT_AUTH_PORT) private readonly agentAuth: FeedAgentAuthPort,
    @Inject(FEED_INGEST_AUTH_PORT) private readonly ingestAuth: FeedIngestAuthPort,
  ) {}

  @Get()
  @Public()
  @ApiFeedOperation("List feed posts", { session: false, responseType: FeedPageResponseDto })
  async list(@Req() request: RequestWithSession, @Query() query: FeedListQueryDto) {
    return this.feed.list({ ...query }, await this.optionalActor(request));
  }

  @Post("posts")
  @UserOrAgent()
  @ApiFeedOperation("Create a feed post", { session: false, status: 201, responseType: FeedPostEnvelopeDto })
  async create(@Req() request: RequestWithSession, @Headers("authorization") authorization: string | undefined, @Body() body: FeedPostBodyDto) {
    return this.feed.create({ ...body }, await this.sessionOrAgent(request, authorization), request);
  }

  @Post("ingest")
  @Internal()
  @ApiFeedOperation("Ingest a feed post", { session: false, status: 201, responseType: FeedPostEnvelopeDto })
  async ingest(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @Headers("authorization") authorization: string | undefined,
    @Body() body: FeedPostBodyDto,
  ) {
    const token = bearer(authorization);
    const principal = token === null ? null : await this.ingestAuth.verifyIngestToken(token);
    if (principal === null) throw new UnauthorizedException();
    const result = await this.feed.ingest({ ...body }, principal, request);
    response.status(result.status);
    return result.body;
  }

  @Get("posts/:id")
  @Public()
  @ApiFeedOperation("Read a feed post", { session: false, responseType: FeedPostEnvelopeDto })
  detail(@Param("id") id: string) {
    return this.feed.detail(postId(id));
  }

  @Get("posts/:id/media")
  @Public()
  @ApiFeedOperation("Read feed post media", { session: false, binary: true })
  async media(@Param("id") id: string, @Res() response: Response): Promise<void> {
    this.sendAsset(await this.feed.asset(postId(id), "media"), response);
  }

  @Get("posts/:id/poster")
  @Public()
  @ApiFeedOperation("Read feed post poster", { session: false, binary: true })
  async poster(@Param("id") id: string, @Res() response: Response): Promise<void> {
    this.sendAsset(await this.feed.asset(postId(id), "poster"), response);
  }

  @Patch("posts/:id")
  @User()
  @ApiFeedOperation("Edit a feed post", { responseType: FeedPostEnvelopeDto })
  patch(@Req() request: RequestWithSession, @Param("id") id: string, @Body() body: FeedPatchDto) {
    return this.feed.patch(postId(id), { ...body }, this.guardedActor(request));
  }

  @Delete("posts/:id")
  @User()
  @ApiFeedOperation("Delete a feed post", { responseType: FeedOkDto })
  delete(@Req() request: RequestWithSession, @Param("id") id: string): Promise<{ readonly ok: true }> {
    return this.feed.delete(postId(id), this.guardedActor(request));
  }

  @Get("posts/:id/comments")
  @Public()
  @ApiFeedOperation("List feed post comments", { responseType: FeedCommentsResponseDto })
  comments(@Param("id") id: string, @Query() query: FeedCommentsQueryDto) {
    return this.feed.comments(postId(id), { ...query });
  }

  @Post("posts/:id/comments")
  @User()
  @ApiFeedOperation("Create a feed post comment", { status: 201, responseType: FeedCommentEnvelopeDto })
  createComment(@Req() request: RequestWithSession, @Param("id") id: string, @Body() body: FeedCommentBodyDto) {
    return this.feed.createComment(postId(id), { ...body }, this.guardedActor(request), request);
  }

  @Delete("comments/:id")
  @User()
  @ApiFeedOperation("Delete a feed comment", { responseType: FeedOkDto })
  deleteComment(@Req() request: RequestWithSession, @Param("id") id: string): Promise<{ readonly ok: true }> {
    return this.feed.deleteComment(commentId(id), this.guardedActor(request));
  }

  @Post("posts/:id/vote")
  @User()
  @HttpCode(200)
  @ApiFeedOperation("Vote on a feed post", { responseType: FeedVoteResponseDto })
  votePost(@Req() request: RequestWithSession, @Param("id") id: string, @Body() body: FeedVoteBodyDto) {
    return this.feed.votePost(postId(id), body.value, this.guardedActor(request), request);
  }

  @Post("comments/:id/vote")
  @User()
  @HttpCode(200)
  @ApiFeedOperation("Vote on a feed comment", { responseType: FeedVoteResponseDto })
  voteComment(@Req() request: RequestWithSession, @Param("id") id: string, @Body() body: FeedVoteBodyDto) {
    return this.feed.voteComment(commentId(id), body.value, this.guardedActor(request), request);
  }

  @Post("posts/:id/save")
  @User()
  @HttpCode(200)
  @ApiFeedOperation("Save a feed post", { responseType: FeedSavedResponseDto })
  save(@Req() request: RequestWithSession, @Param("id") id: string): Promise<{ readonly saved: boolean }> {
    return this.feed.save(postId(id), this.guardedActor(request), request);
  }

  @Delete("posts/:id/save")
  @User()
  @ApiFeedOperation("Unsave a feed post", { responseType: FeedSavedResponseDto })
  unsave(@Req() request: RequestWithSession, @Param("id") id: string): Promise<{ readonly saved: boolean }> {
    return this.feed.unsave(postId(id), this.guardedActor(request));
  }

  @Post("events")
  @User()
  @HttpCode(202)
  @ApiFeedOperation("Record a feed event", { status: 202, responseType: FeedOkDto })
  event(@Req() request: RequestWithSession, @Body() body: FeedEventBodyDto): Promise<{ readonly ok: true }> {
    return this.feed.event({ ...body }, this.guardedActor(request), request);
  }

  @Get("gitverse/parse")
  @User()
  @ApiFeedOperation("Parse a GitVerse repository", { responseType: FeedGitverseMetaDto })
  parseGitverse(@Req() request: RequestWithSession, @Query() query: FeedGitverseQueryDto) {
    return this.feed.parseGitverse(query.url, this.guardedActor(request), request);
  }

  @Post("media")
  @UserOrAgent()
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: MAX_FEED_VIDEO_BYTES, files: 1 } }))
  @ApiFeedUpload("Upload feed media", FeedMediaUploadResponseDto)
  uploadMedia(@Req() request: RequestWithSession, @Headers("authorization") authorization: string | undefined, @UploadedFile() file: UploadedFeedFile | undefined) {
    return this.sessionOrAgent(request, authorization).then((actor) => this.feed.uploadMedia(file, actor, request));
  }

  @Post("posts/:id/images")
  @User()
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: MAX_FEED_IMAGE_BYTES, files: 1 } }))
  @ApiFeedUpload("Upload an inline feed image", FeedImageUploadResponseDto)
  uploadImage(@Req() request: RequestWithSession, @Param("id") id: string, @UploadedFile() file: UploadedFeedFile | undefined) {
    return this.feed.uploadImage(postId(id), file, this.guardedActor(request));
  }

  @Get("posts/:id/images/:fileId")
  @Public()
  @ApiFeedOperation("Read an inline feed image", { session: false, binary: true })
  async image(@Param("id") id: string, @Param("fileId") fileId: string, @Res() response: Response): Promise<void> {
    this.sendAsset(await this.feed.image(postId(id), fileId), response);
  }

  private guardedActor(request: RequestWithSession): FeedActor {
    const session = request[SESSION_USER];
    if (session === undefined) throw new UnauthorizedException();
    return { userId: UserId(session.id), coAuthorAgentId: null };
  }

  private async optionalActor(request: RequestWithSession): Promise<FeedActor | null> {
    const attached = request[SESSION_USER];
    if (attached !== undefined) return { userId: UserId(attached.id), coAuthorAgentId: null };
    const session = await this.sessions.readSession(request);
    return session === null ? null : { userId: UserId(session.id), coAuthorAgentId: null };
  }

  private async sessionOrAgent(request: RequestWithSession, authorization: string | undefined): Promise<FeedActor> {
    const session = await this.optionalActor(request);
    if (session !== null) return session;
    const token = bearer(authorization);
    const actor = token === null ? null : await this.agentAuth.verifyAgentContentToken(token);
    if (actor === null) throw new UnauthorizedException();
    return actor;
  }

  private sendAsset(asset: FeedAsset, response: Response): void {
    if (asset.publicUrl !== null) {
      response.redirect(302, asset.publicUrl);
      return;
    }
    if (asset.object === null) throw new NotFoundException();
    response.type(asset.contentType).set("Cache-Control", "public, max-age=3600");
    if (asset.object.etag !== undefined) response.set("ETag", asset.object.etag);
    if (asset.object.contentLength !== undefined) response.set("Content-Length", String(asset.object.contentLength));
    asset.object.body.on("error", () => response.destroy());
    asset.object.body.pipe(response);
  }
}
