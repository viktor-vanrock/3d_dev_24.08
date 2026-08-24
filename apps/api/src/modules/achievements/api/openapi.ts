import { applyDecorators } from "@nestjs/common";
import { ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import { ApiSessionProtected } from "../../../nest/openapi/api-session-protected.ts";
import { AchievementsResponseDto, WardrobeUnlocksResponseDto } from "./achievements.dto.ts";

export function ApiMyAchievementsOperation(): MethodDecorator {
  return applyDecorators(
    ApiTags("achievements"),
    ApiOperation({ summary: "List achievements earned by the current user" }),
    ApiOkResponse({ type: AchievementsResponseDto }),
    ApiSessionProtected(),
  );
}

export function ApiWardrobeUnlocksOperation(): MethodDecorator {
  return applyDecorators(
    ApiTags("achievements"),
    ApiOperation({ summary: "List wardrobe options unlocked for the current user" }),
    ApiOkResponse({ type: WardrobeUnlocksResponseDto }),
    ApiSessionProtected(),
  );
}
