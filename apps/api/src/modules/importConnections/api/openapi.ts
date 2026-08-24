import { applyDecorators } from "@nestjs/common";
import { ApiBody, ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { ApiSessionProtected } from "../../../nest/openapi/api-session-protected.ts";
import { ApiErrorEnvelopeDto } from "../../../nest/openapi/error-envelope.dto.ts";
import {
  ConnectImportAccountDto,
  ImportChallengeResponseDto,
  ImportConnectionChallengeDto,
  ImportConnectionConnectedResponseDto,
  ImportConnectionsListResponseDto,
  ImportConnectionVerifyDto,
  ImportModelsResponseDto,
  ImportVerificationResponseDto,
} from "./import-connections.dto.ts";

const BODIES = {
  connect: ConnectImportAccountDto,
  challenge: ImportConnectionChallengeDto,
  verify: ImportConnectionVerifyDto,
} as const;

export function ApiImportConnectionsOperation(
  summary: string,
  options: { readonly status?: number; readonly body?: keyof typeof BODIES; readonly response?: "connect" | "models" | "challenge" | "verify" } = {},
): MethodDecorator {
  const decorators: Array<ClassDecorator | MethodDecorator> = [
    ApiTags("import-connections"),
    ApiOperation({ summary }),
    ApiSessionProtected(),
    ApiResponse({
      status: options.status ?? 200,
      type:
        options.response === "connect"
          ? ImportConnectionConnectedResponseDto
          : options.response === "models"
            ? ImportModelsResponseDto
            : options.response === "challenge"
              ? ImportChallengeResponseDto
              : options.response === "verify"
                ? ImportVerificationResponseDto
                : ImportConnectionsListResponseDto,
    }),
    ApiResponse({ status: 400, type: ApiErrorEnvelopeDto }),
    ApiResponse({ status: 404, type: ApiErrorEnvelopeDto }),
    ApiResponse({ status: 409, type: ApiErrorEnvelopeDto }),
    ApiResponse({ status: 502, type: ApiErrorEnvelopeDto }),
  ];
  if (options.body !== undefined) decorators.push(ApiBody({ type: BODIES[options.body] }));
  return applyDecorators(...decorators);
}
