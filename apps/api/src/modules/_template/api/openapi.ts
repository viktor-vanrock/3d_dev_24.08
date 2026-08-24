import { applyDecorators } from "@nestjs/common";
import { ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiParam } from "@nestjs/swagger";
import { ApiSessionProtected } from "../../../nest/openapi/api-session-protected.ts";
import { ApiErrorEnvelopeDto } from "../../../nest/openapi/error-envelope.dto.ts";
import { ExampleResponseDto } from "./example.dto.ts";

// Keep prose, examples and response documentation outside controllers and DTOs.
export function ApiGetExampleEndpoint(): MethodDecorator {
  return applyDecorators(
    ApiOperation({ summary: "Read one example aggregate" }),
    ApiParam({ name: "id", format: "uuid" }),
    ApiSessionProtected(),
    ApiOkResponse({ type: ExampleResponseDto }),
    ApiNotFoundResponse({ description: "Example does not exist", type: ApiErrorEnvelopeDto }),
  );
}
