import { Body, Controller, Get, HttpCode, Inject, NotFoundException, Param, Post, Query, Req, Res, UnauthorizedException, UploadedFiles, UseInterceptors } from "@nestjs/common";
import { AnyFilesInterceptor } from "@nestjs/platform-express";
import type { Response } from "express";
import { SESSION_USER, type RequestWithSession } from "../../../nest/auth/session-verifier.ts";
import { UserId, type UserId as UserIdType } from "../../_kernel/brandedIds.ts";
import { makeId, modelId } from "../application/makes.service.ts";
import { MAX_MAKE_PHOTO_BYTES, MAX_MAKE_PHOTOS } from "../domain/makes.ts";
import { MAKES_PORT, type MakesPort, type MakeUpload } from "../public/index.ts";
import {
  MakeCommentDto,
  MakeCommentsQueryDto,
  MakeCreateDto,
  MakeLeaderboardQueryDto,
  MakeReportDto,
  MakesListQueryDto,
  MakesMineQueryDto,
  MakeCommentResponseDto,
  MakeCommentsResponseDto,
  MakeCounterResponseDto,
  MakeCreateResponseDto,
  MakeDetailResponseDto,
  MakeLeaderboardResponseDto,
  MakePageResponseDto,
  MakeReportResponseDto,
  MakeViewsResponseDto,
  MakeVoteResponseDto,
} from "./makes.dto.ts";
import { ApiMakeCreate, ApiMakesOperation } from "./openapi.ts";

interface UploadedMakeFile {
  readonly fieldname: string;
  readonly buffer: Buffer;
  readonly originalname: string;
  readonly mimetype: string;
}

function userId(request: RequestWithSession): UserIdType {
  const session = request[SESSION_USER];
  if (session === undefined) throw new UnauthorizedException();
  return UserId(session.id);
}

@Controller("makes")
export class MakesController {
  constructor(@Inject(MAKES_PORT) private readonly makes: MakesPort) {}

  @Post(":id/repost")
  @HttpCode(200)
  @ApiMakesOperation("Repost a make", 200, MakeCounterResponseDto)
  repost(@Param("id") id: string) {
    return this.makes.repost(makeId(id));
  }

  @Post(":id/view")
  @HttpCode(200)
  @ApiMakesOperation("Record a make view", 200, MakeViewsResponseDto)
  view(@Param("id") id: string) {
    return this.makes.view(makeId(id));
  }

  @Post(":id/report")
  @HttpCode(202)
  @ApiMakesOperation("Report a make", 202, MakeReportResponseDto)
  report(@Req() request: RequestWithSession, @Param("id") id: string, @Body() body: MakeReportDto) {
    return this.makes.report(makeId(id), userId(request), body.reason, request);
  }

  @Get(":makeId/photos/:photoId")
  @ApiMakesOperation("Read a make photo")
  async photo(@Req() request: RequestWithSession, @Param("makeId") rawMakeId: string, @Param("photoId") photoId: string, @Res() response: Response): Promise<void> {
    const asset = await this.makes.photo(makeId(rawMakeId), photoId, userId(request), request);
    if (asset.publicUrl !== null) {
      response.redirect(302, asset.publicUrl);
      return;
    }
    if (asset.object === null) throw new NotFoundException();
    response.type(asset.contentType).set("Cache-Control", "private, no-cache");
    if (asset.object.etag !== undefined) response.set("ETag", asset.object.etag);
    if (asset.object.contentLength !== undefined) response.set("Content-Length", String(asset.object.contentLength));
    asset.object.body.on("error", () => response.destroy());
    asset.object.body.pipe(response);
  }

  @Post(":id/vote")
  @HttpCode(200)
  @ApiMakesOperation("Toggle a make like", 200, MakeVoteResponseDto)
  vote(@Req() request: RequestWithSession, @Param("id") id: string) {
    return this.makes.vote(makeId(id), userId(request));
  }

  @Post()
  @UseInterceptors(AnyFilesInterceptor({ limits: { fileSize: MAX_MAKE_PHOTO_BYTES, files: MAX_MAKE_PHOTOS } }))
  @ApiMakeCreate(MakeCreateResponseDto)
  create(@Req() request: RequestWithSession, @Body() body: MakeCreateDto, @UploadedFiles() files: readonly UploadedMakeFile[] | undefined) {
    const uploads: MakeUpload[] = (files ?? [])
      .filter((file) => file.fieldname === "photos")
      .map((file) => ({
        buffer: file.buffer,
        filename: file.originalname,
        contentType: file.mimetype,
      }));
    return this.makes.create(userId(request), { ...body }, uploads, request);
  }

  @Get()
  @ApiMakesOperation("List published makes", 200, MakePageResponseDto)
  list(@Query() query: MakesListQueryDto) {
    return this.makes.list({ ...query });
  }

  @Get(":id/comments")
  @ApiMakesOperation("List make comments", 200, MakeCommentsResponseDto)
  comments(@Param("id") id: string, @Query() query: MakeCommentsQueryDto) {
    return this.makes.comments(makeId(id), { ...query });
  }

  @Post(":id/comments")
  @ApiMakesOperation("Create a make comment", 201, MakeCommentResponseDto)
  comment(@Req() request: RequestWithSession, @Param("id") id: string, @Body() body: MakeCommentDto) {
    return this.makes.comment(makeId(id), userId(request), body.body, body.parent_id);
  }

  @Get("mine")
  @ApiMakesOperation("List the current user's makes", 200, MakePageResponseDto)
  mine(@Req() request: RequestWithSession, @Query() query: MakesMineQueryDto) {
    return this.makes.mine(userId(request), { ...query });
  }

  @Get(":id")
  @ApiMakesOperation("Read a make detail", 200, MakeDetailResponseDto)
  detail(@Req() request: RequestWithSession, @Param("id") id: string) {
    return this.makes.detail(makeId(id), userId(request));
  }
}

@Controller("models")
export class ModelMakesController {
  constructor(@Inject(MAKES_PORT) private readonly makes: MakesPort) {}

  @Get(":id/makes/leaderboard")
  @ApiMakesOperation("List the best makes for a model", 200, MakeLeaderboardResponseDto)
  leaderboard(@Param("id") id: string, @Query() query: MakeLeaderboardQueryDto) {
    return this.makes.leaderboard(modelId(id), query.limit);
  }
}
