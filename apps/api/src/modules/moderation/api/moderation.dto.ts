import { IsArray, IsObject, IsOptional, IsString, MinLength } from "class-validator";
export class SubmitFlagDto { @IsObject() target!: { type: string; id: string }; @IsString() reason_code!: string; @IsOptional() @IsString() reason_text?: string; @IsOptional() @IsArray() evidence?: { url: string }[]; }
export class ClaimFlagDto {}
export class ReleaseFlagDto {}
export class DecideFlagDto { @IsString() action!: string; @IsString() reason_code!: string; @IsOptional() @IsString() reason_note?: string; @IsOptional() @IsObject() restriction?: { type: string; scope: string; ends_at: string | null }; @IsOptional() @IsObject() sanction?: { target_user_id: string; type: string; reason_code: string; reason_note: string; evidence_url: string | null; ends_at: string | null }; }
export class ReversalDto { @IsString() @MinLength(10) reason!: string; }
