import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Allow } from "class-validator";
import { DATA_CAPABILITIES, type DataCapability } from "../../permissions/public/index.ts";

export class EmailStartDto {
  @ApiProperty({ type: String, example: "ivan.ivanov" })
  @Allow()
  declare readonly localPart?: unknown;

  @ApiProperty({ type: String, example: "example.ru" })
  @Allow()
  declare readonly domain?: unknown;
}

export class EmailVerifyDto extends EmailStartDto {
  @ApiProperty({ type: String, example: "0123", pattern: "^[0-9]{4}$" })
  @Allow()
  declare readonly code?: unknown;
}

export class PasswordLoginDto {
  @ApiProperty({ type: String, example: "portal.admin" })
  @Allow()
  declare readonly username?: unknown;

  @ApiProperty({ type: String, format: "password", minLength: 1 })
  @Allow()
  declare readonly password?: unknown;
}

export class RegisterDto {
  @ApiProperty({ type: String, format: "email", example: "ivan@example.ru" })
  @Allow()
  declare readonly email?: unknown;

  @ApiProperty({ type: String, format: "password", minLength: 12, maxLength: 20 })
  @Allow()
  declare readonly password?: unknown;

  @ApiProperty({ type: String, minLength: 1, maxLength: 64 })
  @Allow()
  declare readonly displayName?: unknown;

  @ApiPropertyOptional({ type: String, nullable: true })
  @Allow()
  declare readonly gender?: unknown;

  @ApiPropertyOptional({ type: Number, nullable: true })
  @Allow()
  declare readonly birthYear?: unknown;
}

export class RegisterVerifyDto {
  @ApiProperty({ type: String, format: "email" })
  @Allow()
  declare readonly email?: unknown;

  @ApiProperty({ type: String, pattern: "^[0-9]{4}$" })
  @Allow()
  declare readonly code?: unknown;
}

export class RecoveryStartDto {
  @ApiProperty({ type: String, format: "email" })
  @Allow()
  declare readonly email?: unknown;
}

export class RecoveryVerifyDto extends RecoveryStartDto {
  @ApiProperty({ type: String, pattern: "^[0-9]{4}$" })
  @Allow()
  declare readonly code?: unknown;

  @ApiProperty({ type: String, format: "password", minLength: 12, maxLength: 20 })
  @Allow()
  declare readonly newPassword?: unknown;
}

export class PlagIdStartQueryDto {
  @ApiPropertyOptional({ type: String, enum: ["1"], description: "Return to the native UltraDevice application" })
  @Allow()
  declare readonly app?: string;
}

export class PlagIdCallbackQueryDto {
  @ApiPropertyOptional({ type: String })
  @Allow()
  declare readonly token?: string;

  @ApiPropertyOptional({ type: String })
  @Allow()
  declare readonly reason?: string;
}

export class OkResponseDto {
  @ApiProperty({ type: Boolean, example: true })
  declare readonly ok: true;
}

export class AuthUserDto {
  @ApiProperty({ type: String, format: "uuid" })
  declare readonly id: string;

  @ApiProperty({ type: String })
  declare readonly username: string;
}

export class DevLoginResponseDto extends OkResponseDto {
  @ApiProperty({ type: () => AuthUserDto })
  declare readonly user: AuthUserDto;
}

export class DevAvailabilityResponseDto {
  @ApiProperty({ type: Boolean })
  declare readonly available: boolean;
}

export class PasswordLoginResponseDto extends DevLoginResponseDto {}

export class SessionUserDto extends AuthUserDto {
  @ApiProperty({ type: String, nullable: true })
  declare readonly display_name: string | null;

  @ApiProperty({ type: String, nullable: true })
  declare readonly avatar_url: string | null;

  @ApiProperty({ type: Boolean })
  declare readonly handle_confirmed: boolean;

  @ApiProperty({ type: String })
  declare readonly role: string;

  @ApiProperty({ type: String, enum: DATA_CAPABILITIES, isArray: true })
  declare readonly capabilities: readonly DataCapability[];
}

export class SessionResponseDto {
  @ApiProperty({ type: () => SessionUserDto })
  declare readonly user: SessionUserDto;
}
