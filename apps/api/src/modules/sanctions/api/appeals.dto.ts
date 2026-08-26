import { ApiProperty } from "@nestjs/swagger";
import { IsIn, IsString, MaxLength, MinLength } from "class-validator";
export class SubmitAppealDto { @ApiProperty({ maxLength: 4000 }) @IsString() @MinLength(1) @MaxLength(4000) message!: string; }
export class ResolveAppealDto { @ApiProperty({ enum: ["accepted", "rejected"] }) @IsIn(["accepted", "rejected"]) state!: "accepted" | "rejected"; @ApiProperty({ maxLength: 2000 }) @IsString() @MinLength(1) @MaxLength(2000) resolutionNote!: string; }
