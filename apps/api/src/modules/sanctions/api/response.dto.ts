import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
export class SanctionResponseDto {
  @ApiProperty({ format: "uuid" }) id!: string; @ApiProperty({ format: "uuid" }) userId!: string; @ApiProperty() type!: string; @ApiProperty() state!: string; @ApiProperty() reasonCode!: string;
  @ApiPropertyOptional({ nullable: true }) reasonNote!: string | null; @ApiPropertyOptional({ nullable: true }) evidenceUrl!: string | null; @ApiProperty({ format: "date-time" }) startsAt!: Date; @ApiPropertyOptional({ nullable: true, format: "date-time" }) endsAt!: Date | null;
  @ApiProperty({ format: "uuid" }) createdBy!: string; @ApiPropertyOptional({ nullable: true, format: "uuid" }) cancelledBy!: string | null; @ApiProperty({ format: "date-time" }) createdAt!: Date;
}
export class SanctionAppealResponseDto {
  @ApiProperty({ format: "uuid" }) id!: string; @ApiProperty({ format: "uuid" }) sanctionId!: string; @ApiProperty({ format: "uuid" }) submittedBy!: string; @ApiProperty() message!: string; @ApiProperty() state!: string;
  @ApiPropertyOptional({ nullable: true, format: "uuid" }) resolvedBy!: string | null; @ApiPropertyOptional({ nullable: true }) resolutionNote!: string | null;
}
