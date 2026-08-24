import { IsOptional, IsString, MaxLength } from "class-validator";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

export class BanUserDto {
  @ApiPropertyOptional({ type: String, maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  declare readonly reason?: string;
}

export class BannedUserResponseDto {
  @ApiProperty({ format: "uuid" }) declare readonly id: string;
  @ApiProperty({ enum: ["banned"] }) declare readonly status: "banned";
}
