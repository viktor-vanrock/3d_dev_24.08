import { Controller, Get } from "@nestjs/common";
import { ApiProperty } from "@nestjs/swagger";
import { ApiHealthEndpoint } from "./openapi.ts";

export class HealthResponseDto {
  @ApiProperty({ type: String, enum: ["ok"], example: "ok" })
  declare readonly status: "ok";

  @ApiProperty({ type: String, enum: ["api"], example: "api" })
  declare readonly service: "api";
}

@Controller()
export class HealthController {
  @Get("health")
  @ApiHealthEndpoint()
  health(): HealthResponseDto {
    return { status: "ok", service: "api" };
  }
}
