import { Type } from "class-transformer";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from "class-validator";
import { PROJECT_MANUFACTURING_METHODS } from "../domain/project.ts";

export class ProjectPageQueryDto {
  @ApiPropertyOptional({ type: Number, default: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @ApiPropertyOptional({ type: String, maxLength: 512 })
  @IsOptional()
  @IsString()
  @MaxLength(512)
  cursor?: string;
}

export class CreateProjectDto {
  @ApiProperty({ type: String, minLength: 1, maxLength: 200 })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title!: string;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 20_000 })
  @IsOptional()
  @ValidateIf((_object, value) => value !== null)
  @IsString()
  @MaxLength(20_000)
  description?: string | null;

  @ApiPropertyOptional({ type: [String], maxItems: 20, uniqueItems: true })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ArrayUnique()
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, { each: true })
  @MinLength(1, { each: true })
  @MaxLength(64, { each: true })
  tags?: string[];

  @ApiPropertyOptional({ type: String, nullable: true, format: "uri", pattern: "^https://" })
  @IsOptional()
  @ValidateIf((_object, value) => value !== null)
  @IsUrl({ protocols: ["https"], require_protocol: true })
  repo_url?: string | null;
}

export class UpdateProjectDto {
  @ApiPropertyOptional({ type: String, minLength: 1, maxLength: 200, nullable: false })
  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title?: string;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 20_000 })
  @ValidateIf((_object, value) => value !== undefined && value !== null)
  @IsString()
  @MaxLength(20_000)
  description?: string | null;

  @ApiPropertyOptional({ type: [String], maxItems: 20, uniqueItems: true })
  @ValidateIf((_object, value) => value !== undefined)
  @IsArray()
  @ArrayMaxSize(20)
  @ArrayUnique()
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, { each: true })
  @MinLength(1, { each: true })
  @MaxLength(64, { each: true })
  tags?: string[];

  @ApiPropertyOptional({ type: String, nullable: true, format: "uri", pattern: "^https://" })
  @ValidateIf((_object, value) => value !== undefined && value !== null)
  @IsUrl({ protocols: ["https"], require_protocol: true })
  repo_url?: string | null;
}

export class CreateModelDto {
  @ApiProperty({ type: String, minLength: 1, maxLength: 120 })
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  @ApiPropertyOptional({ type: String, enum: PROJECT_MANUFACTURING_METHODS })
  @IsOptional()
  @IsIn(PROJECT_MANUFACTURING_METHODS)
  manufacturing_method?: "fdm" | "sla" | "cnc" | "laser";

  @ApiPropertyOptional({ type: Boolean, default: false })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  requires_ams?: boolean;
}

export class SetPrimaryModelDto {
  @ApiProperty({ type: String, format: "uuid" })
  @IsUUID()
  model_id!: string;
}
