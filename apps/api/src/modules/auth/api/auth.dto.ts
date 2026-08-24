import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Allow } from "class-validator";
import { EMAIL_DOMAINS } from "../domain/auth.ts";

export class EmailStartDto {
  @ApiProperty({ type: String, example: "ivan.ivanov" })
  @Allow()
  declare readonly localPart?: unknown;

  @ApiProperty({ type: String, enum: EMAIL_DOMAINS })
  @Allow()
  declare readonly domain?: unknown;
}

export class EmailVerifyDto extends EmailStartDto {
  @ApiProperty({ type: String, example: "012345", pattern: "^[0-9]{6}$" })
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
}

export class SessionResponseDto {
  @ApiProperty({ type: () => SessionUserDto })
  declare readonly user: SessionUserDto;
}
