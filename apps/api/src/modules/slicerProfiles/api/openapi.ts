import { applyDecorators } from "@nestjs/common";
import { ApiNotFoundResponse, ApiOperation, ApiResponse, ApiTags, ApiTooManyRequestsResponse } from "@nestjs/swagger";
import { ApiSessionProtected } from "../../../nest/openapi/api-session-protected.ts";
import { ApiErrorEnvelopeDto } from "../../../nest/openapi/error-envelope.dto.ts";

export function ApiSlicerProfilesOperation(
  summary: string,
  options: { created?: boolean; rateLimited?: boolean; notFound?: boolean; responseType?: new () => object } = {},
): MethodDecorator {
  const decorators: Array<ClassDecorator | MethodDecorator | PropertyDecorator> = [
    ApiTags("slicer-profiles"),
    ApiOperation({ summary }),
    ApiSessionProtected(),
    ApiResponse({
      status: options.created === true ? 201 : 200,
      description: "Successful response",
      ...(options.responseType === undefined ? {} : { type: options.responseType }),
    }),
  ];
  if (options.notFound === true) decorators.push(ApiNotFoundResponse({ type: ApiErrorEnvelopeDto }));
  if (options.rateLimited === true) decorators.push(ApiTooManyRequestsResponse({ type: ApiErrorEnvelopeDto }));
  return applyDecorators(...decorators);
}
