import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsIn, IsISO8601, IsOptional, IsString, IsUrl, IsUUID, Matches, MaxLength, MinLength, Validate, ValidatorConstraint, type ValidatorConstraintInterface, type ValidationArguments } from "class-validator";

@ValidatorConstraint({ name: "isFutureSanctionEnd", async: false })
class IsFutureSanctionEndConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean { return value === undefined || (typeof value === "string" && !Number.isNaN(Date.parse(value)) && new Date(value) > new Date()); }
  defaultMessage(_arguments: ValidationArguments): string { return "endsAt must be in the future"; }
}

export class CreateSanctionDto {
  @ApiProperty({ format: "uuid" }) @IsUUID() targetId!: string;
  @ApiProperty({ enum: ["suspension", "ban"] }) @IsIn(["suspension", "ban"]) type!: "suspension" | "ban";
  @ApiProperty({ enum: ["spam", "abuse", "fraud", "tos_violation", "security", "other"] }) @IsIn(["spam", "abuse", "fraud", "tos_violation", "security", "other"]) reasonCode!: "spam" | "abuse" | "fraud" | "tos_violation" | "security" | "other";
  @ApiPropertyOptional({ maxLength: 2000 }) @IsOptional() @IsString() @MinLength(1) @MaxLength(2000) reasonNote?: string;
  @ApiPropertyOptional({ format: "uri", maxLength: 2000 }) @IsOptional() @IsUrl({ protocols: ["http", "https"], require_protocol: true }) @MaxLength(2000) evidenceUrl?: string;
  @ApiPropertyOptional({ format: "date-time" }) @IsOptional() @IsISO8601() @Validate(IsFutureSanctionEndConstraint) endsAt?: string;
  @ApiProperty({ minLength: 16, maxLength: 128 }) @IsString() @Matches(/^[A-Za-z0-9._:-]{16,128}$/) idempotencyKey!: string;
}

export class CancelSanctionDto { @ApiProperty({ maxLength: 2000 }) @IsString() @MinLength(1) @MaxLength(2000) cancelReason!: string; }
