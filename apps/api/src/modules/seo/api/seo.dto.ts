import { IsOptional, IsString } from "class-validator";
import { ApiPropertyOptional } from "@nestjs/swagger";

export class SeoMetaQueryDto {
  @ApiPropertyOptional({ type: String, description: "Original storefront path" })
  @IsOptional()
  @IsString()
  declare readonly path?: string;
}
