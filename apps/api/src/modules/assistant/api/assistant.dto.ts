import { Allow } from "class-validator";
import { ApiProperty, ApiPropertyOptional, getSchemaPath } from "@nestjs/swagger";
import { RUN_RESULT_TYPES, RUN_STATUSES, type MessageRole, type RunResultType, type RunStatus } from "../domain/assistant.ts";

export class AssistantLooseBodyDto {
  @ApiPropertyOptional({ type: String }) @Allow() title?: unknown;
  @ApiPropertyOptional({ type: String }) @Allow() content?: unknown;
  @ApiPropertyOptional({ type: String }) @Allow() client_request_id?: unknown;
  @ApiPropertyOptional({ type: String, format: "uuid" }) @Allow() run_id?: unknown;
  @ApiPropertyOptional({ type: String }) @Allow() query?: unknown;
  @ApiPropertyOptional({ type: String, enum: ["home"] }) @Allow() context?: unknown;
  @ApiPropertyOptional({ type: Number, minimum: 1 }) @Allow() limit?: unknown;
  @ApiPropertyOptional({ type: Number, minimum: 1 }) @Allow() batch?: unknown;
  @ApiPropertyOptional({ type: [String] }) @Allow() exclude_labels?: unknown;
}

export class AssistantListQueryDto {
  @ApiPropertyOptional({ type: String }) @Allow() cursor?: unknown;
  @ApiPropertyOptional({ type: Number, minimum: 1 }) @Allow() limit?: unknown;
}

export class AssistantThreadDto {
  @ApiProperty({ type: String, format: "uuid" }) declare id: string;
  @ApiProperty({ type: String, nullable: true }) declare title: string | null;
  @ApiProperty({ type: String, enum: ["chat", "device_incident"] }) declare kind: "chat" | "device_incident";
  @ApiProperty({ type: String, format: "uuid", nullable: true }) declare device_id: string | null;
  @ApiProperty({ type: String, enum: ["info", "warning", "critical"], nullable: true }) declare severity: "info" | "warning" | "critical" | null;
  @ApiProperty({ type: String, enum: ["open", "acknowledged", "resolved"], nullable: true }) declare incident_status: "open" | "acknowledged" | "resolved" | null;
  @ApiProperty({ type: String, format: "date-time", nullable: true }) declare read_at: Date | null;
  @ApiProperty({ type: Boolean }) declare unread: boolean;
  @ApiProperty({ type: String, format: "date-time" }) declare created_at: Date;
  @ApiProperty({ type: String, format: "date-time" }) declare updated_at: Date;
}
export class AssistantThreadResponseDto {
  @ApiProperty({ type: AssistantThreadDto }) declare thread: AssistantThreadDto;
}
export class AssistantThreadsResponseDto {
  @ApiProperty({ type: [AssistantThreadDto] }) declare items: readonly AssistantThreadDto[];
  @ApiProperty({ type: String, nullable: true }) declare next_cursor: string | null;
}

export class AssistantMessageDto {
  @ApiProperty({ type: String, format: "uuid" }) declare id: string;
  @ApiProperty({ type: String, format: "uuid" }) declare thread_id: string;
  @ApiProperty({ type: String, enum: ["user", "assistant"] }) declare role: MessageRole;
  @ApiProperty({ type: String }) declare content: string;
  @ApiProperty({ type: String, format: "uuid", nullable: true }) declare run_id: string | null;
  @ApiProperty({ type: String, format: "date-time" }) declare created_at: Date;
}
export class AssistantMessagesResponseDto {
  @ApiProperty({ type: [AssistantMessageDto] }) declare items: readonly AssistantMessageDto[];
  @ApiProperty({ type: String, nullable: true }) declare next_cursor: string | null;
}

export class AssistantCitationDto {
  @ApiProperty({ type: String, format: "uuid" }) declare model_id: string;
  @ApiProperty({ type: String }) declare title: string;
  @ApiProperty({ type: String }) declare snippet: string;
  @ApiProperty({ type: Number }) declare score: number;
  @ApiProperty({ type: String, nullable: true }) declare source_url: string | null;
}
export class AssistantAnswerResultDto {
  @ApiProperty({ type: String, enum: ["answer"] }) declare kind: "answer";
  @ApiProperty({ type: String }) declare text: string;
  @ApiProperty({ type: [AssistantCitationDto] }) declare citations: readonly AssistantCitationDto[];
  @ApiProperty({ type: String, nullable: true }) declare note: string | null;
}
export class AssistantClarificationResultDto {
  @ApiProperty({ type: String, enum: ["clarification"] }) declare kind: "clarification";
  @ApiProperty({ type: String }) declare question: string;
  @ApiProperty({ type: String, nullable: true }) declare reason: string | null;
}
export class AssistantGenerationOfferResultDto {
  @ApiProperty({ type: String, enum: ["generation_offer"] }) declare kind: "generation_offer";
  @ApiProperty({ type: String, format: "uuid" }) declare offer_id: string;
  @ApiProperty({ type: String, nullable: true }) declare branch: string | null;
  @ApiProperty({ type: String }) declare prompt_summary: string;
  @ApiProperty({ type: String, nullable: true }) declare note: string | null;
}
export class AssistantErrorResultDto {
  @ApiProperty({ type: String, enum: ["error"] }) declare kind: "error";
  @ApiProperty({ type: String }) declare code: string;
  @ApiProperty({ type: Boolean }) declare retryable: boolean;
}
export class AssistantRunDto {
  @ApiProperty({ type: String, format: "uuid" }) declare id: string;
  @ApiProperty({ type: String, format: "uuid" }) declare thread_id: string;
  @ApiProperty({ type: String, format: "uuid" }) declare triggering_message_id: string;
  @ApiProperty({ type: String, enum: RUN_STATUSES }) declare status: RunStatus;
  @ApiProperty({ type: String, enum: RUN_RESULT_TYPES, nullable: true }) declare result_type: RunResultType | null;
  @ApiProperty({
    oneOf: [
      ...[AssistantAnswerResultDto, AssistantClarificationResultDto, AssistantGenerationOfferResultDto, AssistantErrorResultDto].map((type) => ({ $ref: getSchemaPath(type) })),
      { type: "object", additionalProperties: false, maxProperties: 0 },
    ],
  })
  declare result: AssistantAnswerResultDto | AssistantClarificationResultDto | AssistantGenerationOfferResultDto | AssistantErrorResultDto | { readonly kind?: never };
  @ApiProperty({ type: String, nullable: true }) declare error_code: string | null;
  @ApiProperty({ type: String, format: "uuid", nullable: true }) declare confirmed_generation_id: string | null;
  @ApiProperty({ type: Number, nullable: true }) declare queue_position: number | null;
  @ApiProperty({ type: Number, nullable: true }) declare eta_seconds: number | null;
  @ApiProperty({ type: String, format: "date-time" }) declare created_at: Date;
  @ApiProperty({ type: String, format: "date-time" }) declare updated_at: Date;
}
export class AssistantRunResponseDto {
  @ApiProperty({ type: AssistantRunDto }) declare run: AssistantRunDto;
}
export class AssistantMessageCreatedResponseDto {
  @ApiProperty({ type: AssistantMessageDto }) declare message: AssistantMessageDto;
  @ApiProperty({ type: AssistantRunDto, nullable: true }) declare run: AssistantRunDto | null;
}

export class AssistantPromptIntentDto {
  @ApiProperty({ type: String }) declare normalized_query: string;
  @ApiProperty({ type: String, nullable: true }) declare motif: string | null;
}
export class AssistantPromptVariantDto {
  @ApiProperty({ type: String }) declare id: string;
  @ApiProperty({ type: String }) declare label: string;
  @ApiProperty({ type: String }) declare prompt: string;
  @ApiProperty({ type: String, nullable: true }) declare motif: string | null;
  @ApiProperty({ type: Number }) declare confidence: number;
}
export class AssistantCatalogMatchDto {
  @ApiProperty({ type: String, format: "uuid" }) declare model_id: string;
  @ApiProperty({ type: String }) declare title: string;
  @ApiProperty({ type: Number }) declare relevance_rank: number;
}
export class AssistantPromptVariantsResponseDto {
  @ApiProperty({ type: String, enum: ["assistant.prompt-variants.v1"] }) declare contract_version: "assistant.prompt-variants.v1";
  @ApiProperty({ type: String, format: "uuid" }) declare request_id: string;
  @ApiProperty({ type: AssistantPromptIntentDto }) declare intent: AssistantPromptIntentDto;
  @ApiProperty({ type: [AssistantPromptVariantDto] }) declare variants: readonly AssistantPromptVariantDto[];
  @ApiProperty({ type: [AssistantCatalogMatchDto] }) declare catalog_matches: readonly AssistantCatalogMatchDto[];
  @ApiPropertyOptional({ type: Boolean, enum: [true] }) declare degraded?: true;
}

export class AssistantThreadSnapshotEventDto {
  @ApiProperty({ type: String, format: "uuid" }) declare thread_id: string;
  @ApiProperty({ type: String, enum: ["chat", "device_incident"] }) declare kind: "chat" | "device_incident";
  @ApiProperty({ type: String, enum: ["info", "warning", "critical"], nullable: true }) declare severity: "info" | "warning" | "critical" | null;
  @ApiProperty({ type: String, enum: ["open", "acknowledged", "resolved"], nullable: true }) declare incident_status: "open" | "acknowledged" | "resolved" | null;
  @ApiProperty({ type: String, format: "date-time", nullable: true }) declare read_at: Date | null;
}
export class AssistantRunSnapshotEventDto {
  @ApiProperty({ type: AssistantRunDto }) declare run: AssistantRunDto;
}
export class AssistantCompletedEventDto {
  @ApiProperty({ type: String, enum: ["done"] }) declare status: "done";
}
export class AssistantErrorEventDto {
  @ApiProperty({ type: String, nullable: true }) declare error_code: string | null;
}
export class AssistantIncidentEventDto {
  @ApiProperty({ type: String, format: "uuid" }) declare incident_id: string;
  @ApiProperty({ type: String, enum: ["acknowledged", "resolved"] }) declare status: "acknowledged" | "resolved";
}
