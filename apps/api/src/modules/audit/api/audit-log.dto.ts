import { ApiPropertyOptional } from "@nestjs/swagger";
import { Allow } from "class-validator";

export class AuditLogQueryDto {
  @ApiPropertyOptional({ format: "uuid" }) @Allow() declare readonly actor_user_id?: string;
  @ApiPropertyOptional() @Allow() declare readonly subject_type?: string;
  @ApiPropertyOptional({ format: "uuid" }) @Allow() declare readonly subject_id?: string;
  @ApiPropertyOptional() @Allow() declare readonly action?: string;
  @ApiPropertyOptional({ format: "date-time" }) @Allow() declare readonly from?: string;
  @ApiPropertyOptional({ format: "date-time" }) @Allow() declare readonly to?: string;
  @ApiPropertyOptional({ minimum: 1, maximum: 100 }) @Allow() declare readonly limit?: string;
  @ApiPropertyOptional({ minimum: 0 }) @Allow() declare readonly offset?: string;
}
