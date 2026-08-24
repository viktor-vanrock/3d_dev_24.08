import { applyDecorators } from "@nestjs/common";
import { ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import { HealthResponseDto } from "./health.controller.ts";

export function ApiHealthEndpoint(): MethodDecorator {
  return applyDecorators(
    ApiTags("runtime"),
    ApiOperation({ summary: "Liveness and readiness probe" }),
    ApiOkResponse({ description: "API process is ready to serve traffic", type: HealthResponseDto }),
  );
}
