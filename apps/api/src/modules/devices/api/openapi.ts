import { applyDecorators } from "@nestjs/common";
import { ApiBody, ApiOperation, ApiProduces, ApiResponse, ApiTags, getSchemaPath } from "@nestjs/swagger";
import { ApiSessionProtected } from "../../../nest/openapi/api-session-protected.ts";
import { ApiErrorEnvelopeDto } from "../../../nest/openapi/error-envelope.dto.ts";
import { DeviceLooseBodyDto } from "./devices.dto.ts";

export function ApiDevicesOperation(
  summary: string,
  options: {
    readonly session?: boolean;
    readonly status?: number;
    readonly additionalSuccess?: readonly number[];
    readonly body?: boolean;
    readonly contentType?: string;
    readonly responseType?: new () => object;
  } = {},
): MethodDecorator {
  const decorators: Array<ClassDecorator | MethodDecorator> = [
    ApiTags("devices"),
    ApiOperation({ summary }),
    ApiResponse({
      status: options.status ?? 200,
      ...(options.responseType === undefined ? {} : { type: options.responseType }),
      ...(options.contentType === undefined ? {} : { content: { [options.contentType]: { schema: { type: "string" } } } }),
    }),
    ...(options.additionalSuccess ?? []).map((status) => ApiResponse({ status, ...(options.responseType === undefined ? {} : { type: options.responseType }) })),
  ];
  if (options.session !== false) decorators.push(ApiSessionProtected());
  if (options.body === true) decorators.push(ApiBody({ type: DeviceLooseBodyDto }));
  if (options.contentType !== undefined) decorators.push(ApiProduces(options.contentType));
  const errorContent = { "application/json": { schema: { $ref: getSchemaPath(ApiErrorEnvelopeDto) } } };
  decorators.push(...[400, 404, 422].map((status) => ApiResponse({ status, content: errorContent })));
  return applyDecorators(...decorators);
}
