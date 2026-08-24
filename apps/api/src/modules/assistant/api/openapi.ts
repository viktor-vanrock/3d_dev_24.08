import { applyDecorators } from "@nestjs/common";
import { ApiBody, ApiExtraModels, ApiOperation, ApiProduces, ApiResponse, ApiTags, getSchemaPath } from "@nestjs/swagger";
import { ApiSessionProtected } from "../../../nest/openapi/api-session-protected.ts";
import { ApiErrorEnvelopeDto } from "../../../nest/openapi/error-envelope.dto.ts";
import {
  AssistantAnswerResultDto,
  AssistantClarificationResultDto,
  AssistantCompletedEventDto,
  AssistantErrorEventDto,
  AssistantErrorResultDto,
  AssistantGenerationOfferResultDto,
  AssistantIncidentEventDto,
  AssistantLooseBodyDto,
  AssistantMessageCreatedResponseDto,
  AssistantMessagesResponseDto,
  AssistantPromptVariantsResponseDto,
  AssistantRunResponseDto,
  AssistantRunSnapshotEventDto,
  AssistantThreadResponseDto,
  AssistantThreadSnapshotEventDto,
  AssistantThreadsResponseDto,
} from "./assistant.dto.ts";

const RUN_RESULT_MODELS = [AssistantAnswerResultDto, AssistantClarificationResultDto, AssistantGenerationOfferResultDto, AssistantErrorResultDto];
const JSON_ERROR_CONTENT = { "application/json": { schema: { $ref: getSchemaPath(ApiErrorEnvelopeDto) } } };

export function ApiAssistantOperation(
  summary: string,
  options: {
    readonly status?: number;
    readonly body?: boolean;
    readonly replay?: boolean;
    readonly sse?: "thread" | "run";
    readonly response?: "thread" | "threads" | "messages" | "message" | "run" | "generation" | "prompt-variants";
  } = {},
): MethodDecorator {
  const responseType =
    options.response === "threads"
      ? AssistantThreadsResponseDto
      : options.response === "messages"
        ? AssistantMessagesResponseDto
        : options.response === "message"
          ? AssistantMessageCreatedResponseDto
          : options.response === "run"
            ? AssistantRunResponseDto
            : options.response === "prompt-variants"
              ? AssistantPromptVariantsResponseDto
              : AssistantThreadResponseDto;
  const sseSchemas =
    options.sse === "thread"
      ? [AssistantThreadSnapshotEventDto, AssistantIncidentEventDto]
      : [AssistantRunSnapshotEventDto, ...RUN_RESULT_MODELS, AssistantCompletedEventDto, AssistantErrorEventDto];
  const success =
    options.sse === undefined
      ? options.response === "generation"
        ? ApiResponse({ status: options.status ?? 200, content: { "application/json": { schema: { $ref: "#/components/schemas/GenerationResponseDto" } } } })
        : ApiResponse({ status: options.status ?? 200, type: responseType })
      : ApiResponse({
          status: 200,
          description:
            options.sse === "thread"
              ? "SSE events: thread.snapshot, incident.acknowledged, incident.resolved"
              : "SSE events: assistant.snapshot, assistant.delta, assistant.completed, assistant.error",
          content: { "text/event-stream": { schema: { oneOf: sseSchemas.map((type) => ({ $ref: getSchemaPath(type) })) } } },
        });
  const decorators: Array<ClassDecorator | MethodDecorator> = [
    ApiTags("assistant"),
    ApiOperation({ summary }),
    ApiSessionProtected(),
    ApiExtraModels(
      ...RUN_RESULT_MODELS,
      AssistantThreadSnapshotEventDto,
      AssistantIncidentEventDto,
      AssistantRunSnapshotEventDto,
      AssistantCompletedEventDto,
      AssistantErrorEventDto,
    ),
    success,
    ...[400, 401, 404, 409, 413, 422, 429, 500].map((status) => ApiResponse({ status, content: JSON_ERROR_CONTENT })),
  ];
  if (options.replay === true) {
    decorators.push(
      options.response === "generation"
        ? ApiResponse({ status: 200, content: { "application/json": { schema: { $ref: "#/components/schemas/GenerationResponseDto" } } } })
        : ApiResponse({ status: 200, type: responseType }),
    );
  }
  if (options.sse !== undefined) decorators.push(ApiProduces("text/event-stream"));
  if (options.body === true) decorators.push(ApiBody({ type: AssistantLooseBodyDto }));
  return applyDecorators(...decorators);
}
