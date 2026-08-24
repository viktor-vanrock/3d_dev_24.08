import { ApiProperty } from "@nestjs/swagger";

export class AchievementDto {
  @ApiProperty({ type: String, example: "first_make" })
  declare readonly slug: string;

  @ApiProperty({ type: String, example: "Первый Make" })
  declare readonly title: string;

  @ApiProperty({ type: String, example: "Опубликован первый Make — печать реального объекта." })
  declare readonly description: string;

  @ApiProperty({ type: String, format: "date-time" })
  declare readonly granted_at: string;
}

export class AchievementsResponseDto {
  @ApiProperty({ type: () => [AchievementDto] })
  declare readonly achievements: readonly AchievementDto[];
}

export class WardrobeLayersDto {
  @ApiProperty({ type: [String] }) declare readonly color: readonly string[];
  @ApiProperty({ type: [String] }) declare readonly texture: readonly string[];
  @ApiProperty({ type: [String] }) declare readonly pose: readonly string[];
  @ApiProperty({ type: [String] }) declare readonly outfit: readonly string[];
  @ApiProperty({ type: [String] }) declare readonly hat: readonly string[];
  @ApiProperty({ type: [String] }) declare readonly eyes: readonly string[];
  @ApiProperty({ type: [String] }) declare readonly beard: readonly string[];
  @ApiProperty({ type: [String] }) declare readonly arms: readonly string[];
  @ApiProperty({ type: [String] }) declare readonly accessory: readonly string[];
  @ApiProperty({ type: [String] }) declare readonly back: readonly string[];
}

export class GrantedWardrobeRewardDto {
  @ApiProperty({ type: String, example: "first_make" })
  declare readonly achievement_slug: string;

  @ApiProperty({ type: String, example: "outfit" })
  declare readonly layer: string;

  @ApiProperty({ type: String, example: "apron" })
  declare readonly option_id: string;

  @ApiProperty({ type: String, format: "date-time" })
  declare readonly granted_at: string;
}

export class WardrobeUnlocksResponseDto {
  @ApiProperty({ type: () => WardrobeLayersDto })
  declare readonly layers: WardrobeLayersDto;

  @ApiProperty({ type: () => [GrantedWardrobeRewardDto] })
  declare readonly rewards: readonly GrantedWardrobeRewardDto[];
}
