import { Type } from "class-transformer";
import { IsBoolean, IsDefined, IsIn, IsNotEmpty, IsString, ValidateNested } from "class-validator";
import { ApiProperty } from "@nestjs/swagger";
import { PUSH_TYPES, type PushType } from "../domain/push.ts";

export class PushKeysDto {
  @ApiProperty({ type: String })
  @IsString()
  @IsNotEmpty()
  declare readonly p256dh: string;

  @ApiProperty({ type: String })
  @IsString()
  @IsNotEmpty()
  declare readonly auth: string;
}

export class SubscribePushDto {
  @ApiProperty({ type: String })
  @IsString()
  @IsNotEmpty()
  declare readonly endpoint: string;

  @ApiProperty({ type: () => PushKeysDto })
  @IsDefined()
  @ValidateNested()
  @Type(() => PushKeysDto)
  declare readonly keys: PushKeysDto;
}

export class UnsubscribePushDto {
  @ApiProperty({ type: String })
  @IsString()
  @IsNotEmpty()
  declare readonly endpoint: string;
}

export class SetPushPreferenceDto {
  @ApiProperty({ type: String, enum: PUSH_TYPES })
  @IsIn(PUSH_TYPES)
  declare readonly type: PushType;

  @ApiProperty({ type: Boolean })
  @IsBoolean()
  declare readonly enabled: boolean;
}

export class PushOkResponseDto {
  @ApiProperty({ enum: [true] }) declare readonly ok: true;
}

export class VapidPublicKeyResponseDto {
  @ApiProperty({ type: String, nullable: true }) declare readonly public_key: string | null;
}

export class PushPreferenceResponseDto {
  @ApiProperty({ enum: PUSH_TYPES }) declare readonly type: PushType;
  @ApiProperty() declare readonly enabled: boolean;
}

export class PushPreferencesResponseDto {
  @ApiProperty({ type: [PushPreferenceResponseDto] })
  declare readonly preferences: readonly PushPreferenceResponseDto[];
}
