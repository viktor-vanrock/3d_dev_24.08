// _template — api layer DTOs. Strict typed boundary in/out (spec api-runtime → «Строгая типизация
// границы»). In phase 2 these gain class-validator decorators + @nestjs/swagger @ApiProperty; the
// long descriptions/examples live in api/openapi.ts, not inline here.

import { ApiProperty } from "@nestjs/swagger";
import { IsUUID } from "class-validator";

export class GetExampleParamsDto {
  @ApiProperty({ type: String, format: "uuid" })
  @IsUUID()
  declare readonly id: string; // validated + branded to ExampleId in the controller
}

export class ExampleResponseDto {
  @ApiProperty({ type: String, format: "uuid" })
  declare readonly id: string;

  @ApiProperty({ type: String })
  declare readonly name: string;
}
