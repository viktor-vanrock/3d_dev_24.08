import { Body, Controller, Get, Headers, Inject, NotFoundException, Param, Patch, Post, Req, Res, UploadedFile, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import type { Response } from "express";
import type { RequestWithSession } from "../../../nest/auth/session-verifier.ts";
import { SESSION_USER } from "../../../nest/auth/session-verifier.ts";
import { UserId, type UserId as UserIdType } from "../../_kernel/brandedIds.ts";
import { ProfileService, MAX_AVATAR_PHOTO_BYTES } from "../application/profile.service.ts";
import { AVATAR_SNAPSHOT_SIDES, type AvatarSnapshotSide, IMAGE_FORMATS } from "../domain/profile.ts";
import { ApiAvatarPhotoUpload, ApiProfileOperation } from "./openapi.ts";
import { AvatarResponseDto, PatchAvatarDto, PatchProfileDto, PublicProfileResponseDto, UpdatedProfileResponseDto } from "./profile.dto.ts";
import { Public, User } from "../../permissions/public/index.ts";

interface UploadedAvatarFile {
  readonly buffer: Buffer;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CONTENT_TYPE_BY_EXT: Readonly<Record<string, string>> = Object.fromEntries(Object.values(IMAGE_FORMATS).map(({ ext, contentType }) => [ext, contentType]));

function sessionUserId(request: RequestWithSession): UserIdType {
  const session = request[SESSION_USER];
  if (session === undefined) throw new NotFoundException();
  return UserId(session.id);
}

function userId(value: string): UserIdType {
  if (!UUID_RE.test(value)) throw new NotFoundException();
  return UserId(value);
}

function side(value: string): AvatarSnapshotSide {
  if (!AVATAR_SNAPSHOT_SIDES.includes(value as AvatarSnapshotSide)) throw new NotFoundException();
  return value as AvatarSnapshotSide;
}

@Controller()
@User()
export class ProfileController {
  constructor(@Inject(ProfileService) private readonly profile: ProfileService) {}

  @Get("users/:username")
  @ApiProfileOperation("Read a public maker profile", { notFound: true, pathParams: ["username"], responseType: PublicProfileResponseDto })
  async publicProfile(@Req() request: RequestWithSession, @Param("username") username: string): Promise<PublicProfileResponseDto> {
    return this.profile.profile(username, sessionUserId(request));
  }

  @Patch("me")
  @ApiProfileOperation("Update the current user's profile", { responseType: UpdatedProfileResponseDto })
  async patchProfile(@Req() request: RequestWithSession, @Body() body: PatchProfileDto): Promise<UpdatedProfileResponseDto> {
    return this.profile.patchProfile(sessionUserId(request), body);
  }

  @Get("me/avatar")
  @ApiProfileOperation("Read the current mascot configuration", { notFound: true, responseType: AvatarResponseDto })
  async avatar(@Req() request: RequestWithSession): Promise<AvatarResponseDto> {
    return this.profile.avatar(sessionUserId(request));
  }

  @Patch("me/avatar")
  @ApiProfileOperation("Update the current mascot configuration and snapshots", { responseType: AvatarResponseDto })
  async patchAvatar(@Req() request: RequestWithSession, @Body() body: PatchAvatarDto): Promise<AvatarResponseDto> {
    return this.profile.patchAvatar(sessionUserId(request), body);
  }

  @Post("me/avatar-photo")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: MAX_AVATAR_PHOTO_BYTES, files: 1 } }))
  @ApiAvatarPhotoUpload()
  async uploadAvatarPhoto(@Req() request: RequestWithSession, @UploadedFile() file: UploadedAvatarFile | undefined): Promise<UpdatedProfileResponseDto> {
    return this.profile.uploadAvatarPhoto(sessionUserId(request), file);
  }

  @Get("avatars/:userId")
  @Public()
  @ApiProfileOperation("Read an active user's profile photo", { notFound: true, contentType: "image/*", pathParams: ["userId"] })
  async avatarPhoto(@Param("userId") rawUserId: string, @Res() response: Response): Promise<void> {
    const asset = await this.profile.avatarAsset(userId(rawUserId));
    if (asset.publicUrl !== null) {
      response.redirect(302, asset.publicUrl);
      return;
    }
    const object = asset.object;
    if (object === null) throw new NotFoundException();
    const ext = asset.key.split(".").pop() ?? "";
    response.type(CONTENT_TYPE_BY_EXT[ext] ?? "application/octet-stream").set("Cache-Control", "private, max-age=3600");
    if (object.etag !== undefined) response.set("ETag", object.etag);
    if (object.contentLength !== undefined) response.set("Content-Length", String(object.contentLength));
    object.body.on("error", () => response.destroy());
    object.body.pipe(response);
  }

  @Get("avatars/:userId/snapshots/:side")
  @Public()
  @ApiProfileOperation("Redirect a legacy mascot snapshot URL to its immutable revision", {
    session: false,
    notFound: true,
    redirectOnly: true,
    pathParams: ["userId", "side"],
  })
  async currentSnapshot(@Param("userId") rawUserId: string, @Param("side") rawSide: string, @Res() response: Response): Promise<void> {
    const location = await this.profile.currentSnapshot(userId(rawUserId), side(rawSide));
    response.set("Cache-Control", "no-store").redirect(302, location);
  }

  @Get("avatars/:userId/snapshots/:revision/:side/:sha256.png")
  @Public()
  @ApiProfileOperation("Read an immutable mascot snapshot", {
    session: false,
    notFound: true,
    contentType: "image/png",
    pathParams: ["userId", "revision", "side", "sha256"],
  })
  async snapshot(
    @Param("userId") rawUserId: string,
    @Param("revision") rawRevision: string,
    @Param("side") rawSide: string,
    @Param("sha256") sha256: string,
    @Headers("if-none-match") ifNoneMatch: string | undefined,
    @Res() response: Response,
  ): Promise<void> {
    const revision = Number(rawRevision);
    if (!Number.isSafeInteger(revision) || revision <= 0 || !/^[0-9a-f]{64}$/.test(sha256)) throw new NotFoundException();
    const asset = await this.profile.snapshotAsset(userId(rawUserId), revision, side(rawSide), sha256);
    response.set("Cache-Control", "public, max-age=31536000, immutable");
    if (asset.publicUrl !== null) {
      response.redirect(302, asset.publicUrl);
      return;
    }
    const object = asset.object;
    if (object === null) throw new NotFoundException();
    response.type("image/png");
    if (object.etag !== undefined) {
      response.set("ETag", object.etag);
      if (ifNoneMatch === object.etag) {
        object.body.destroy();
        response.status(304).end();
        return;
      }
    }
    if (object.contentLength !== undefined) response.set("Content-Length", String(object.contentLength));
    object.body.on("error", () => response.destroy());
    object.body.pipe(response);
  }
}
