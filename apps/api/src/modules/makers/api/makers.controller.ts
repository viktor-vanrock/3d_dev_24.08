import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Post, Put, Query, Req, UnauthorizedException } from "@nestjs/common";
import { SESSION_USER, type RequestWithSession } from "../../../nest/auth/session-verifier.ts";
import { UserId, type UserId as UserIdType } from "../../_kernel/brandedIds.ts";
import { MAKERS_PORT, type MakersPort } from "../public/index.ts";
import { ApiMakersOperation } from "./openapi.ts";
import { MakerFeedResponseDto, MakerProfileInputDto, MakerProfileResponseDto, MakersFeedQueryDto, MakersNearbyQueryDto, NearbyMakersResponseDto } from "./makers.dto.ts";

function user(request: RequestWithSession): UserIdType {
  const session = request[SESSION_USER];
  if (session === undefined) throw new UnauthorizedException();
  return UserId(session.id);
}

@Controller()
export class MakersController {
  constructor(@Inject(MAKERS_PORT) private readonly makers: MakersPort) {}

  @Get("makers/feed")
  @ApiMakersOperation("List followed makers' published makes", { responseType: MakerFeedResponseDto })
  feed(@Req() request: RequestWithSession, @Query() query: MakersFeedQueryDto) {
    return this.makers.feed(user(request), query);
  }

  @Post("users/:username/follow")
  @HttpCode(204)
  @ApiMakersOperation("Follow an active maker", { status: 204 })
  follow(@Req() request: RequestWithSession, @Param("username") username: string) {
    return this.makers.follow(user(request), username);
  }

  @Delete("users/:username/follow")
  @HttpCode(204)
  @ApiMakersOperation("Unfollow a maker", { status: 204 })
  unfollow(@Req() request: RequestWithSession, @Param("username") username: string) {
    return this.makers.unfollow(user(request), username);
  }

  @Get("me/maker-profile")
  @ApiMakersOperation("Read the current maker service profile", { responseType: MakerProfileResponseDto })
  profile(@Req() request: RequestWithSession) {
    return this.makers.profile(user(request));
  }

  @Put("me/maker-profile")
  @ApiMakersOperation("Create or replace the current maker service profile", { responseType: MakerProfileResponseDto })
  updateProfile(@Req() request: RequestWithSession, @Body() body: MakerProfileInputDto) {
    return this.makers.updateProfile(user(request), body);
  }

  @Get("makers/nearby")
  @ApiMakersOperation("Find active makers near a point", { public: true, responseType: NearbyMakersResponseDto })
  nearby(@Query() query: MakersNearbyQueryDto) {
    return this.makers.nearby(query);
  }
}
