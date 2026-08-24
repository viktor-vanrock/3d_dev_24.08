import { Controller, Get, Inject, Req, UnauthorizedException } from "@nestjs/common";
import type { RequestWithSession } from "../../../nest/auth/session-verifier.ts";
import { SESSION_USER } from "../../../nest/auth/session-verifier.ts";
import { UserId, type UserId as UserIdType } from "../../_kernel/brandedIds.ts";
import { ACHIEVEMENTS_PORT, type AchievementsPort } from "../public/index.ts";
import type { AchievementsResponseDto, WardrobeUnlocksResponseDto } from "./achievements.dto.ts";
import { ApiMyAchievementsOperation, ApiWardrobeUnlocksOperation } from "./openapi.ts";

function currentUserId(request: RequestWithSession): UserIdType {
  const session = request[SESSION_USER];
  if (session === undefined) throw new UnauthorizedException();
  return UserId(session.id);
}

@Controller("me")
export class AchievementsController {
  constructor(@Inject(ACHIEVEMENTS_PORT) private readonly achievements: AchievementsPort) {}

  @Get("achievements")
  @ApiMyAchievementsOperation()
  async list(@Req() request: RequestWithSession): Promise<AchievementsResponseDto> {
    return { achievements: await this.achievements.achievements(currentUserId(request)) };
  }

  @Get("wardrobe/unlocks")
  @ApiWardrobeUnlocksOperation()
  wardrobeUnlocks(@Req() request: RequestWithSession): Promise<WardrobeUnlocksResponseDto> {
    return this.achievements.wardrobeUnlocks(currentUserId(request));
  }
}
