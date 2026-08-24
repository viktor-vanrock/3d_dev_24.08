import { applyDecorators, type Type } from "@nestjs/common";
import { ApiBody, ApiConsumes, ApiNotFoundResponse, ApiOperation, ApiParam, ApiResponse, ApiTags } from "@nestjs/swagger";
import { ApiErrorEnvelopeDto } from "../../../nest/openapi/error-envelope.dto.ts";
import { ApiSessionProtected } from "../../../nest/openapi/api-session-protected.ts";
import { UpdatedProfileResponseDto } from "./profile.dto.ts";

export function ApiProfileOperation(
  summary: string,
  options: {
    readonly session?: boolean;
    readonly notFound?: boolean;
    readonly responseType?: Type<unknown>;
    readonly contentType?: string;
    readonly redirectOnly?: boolean;
    readonly pathParams?: readonly string[];
  } = {},
) {
  const decorators: Array<ClassDecorator | MethodDecorator> = [ApiTags("profile"), ApiOperation({ summary })];
  if (options.session !== false) decorators.push(ApiSessionProtected());
  if (options.notFound === true) decorators.push(ApiNotFoundResponse({ type: ApiErrorEnvelopeDto }));
  if (options.responseType !== undefined) decorators.push(ApiResponse({ status: 200, type: options.responseType }));
  if (options.contentType !== undefined) {
    decorators.push(
      ApiResponse({
        status: 200,
        content: { [options.contentType]: { schema: { type: "string", format: "binary" } } },
      }),
      ApiResponse({
        status: 302,
        description: "Redirect to the public object URL",
        headers: { Location: { required: true, schema: { type: "string", format: "uri" } } },
      }),
    );
  }
  if (options.redirectOnly === true) {
    decorators.push(
      ApiResponse({
        status: 302,
        description: "Redirect to the immutable snapshot URL",
        headers: { Location: { required: true, schema: { type: "string", format: "uri-reference" } } },
      }),
    );
  }
  for (const name of options.pathParams ?? []) decorators.push(ApiParam({ name, required: true, schema: { type: "string" } }));
  return applyDecorators(...decorators);
}

export function ApiAvatarPhotoUpload(): MethodDecorator {
  return applyDecorators(
    ApiProfileOperation("Upload the current user's profile photo"),
    ApiConsumes("multipart/form-data"),
    ApiBody({ schema: { type: "object", required: ["file"], properties: { file: { type: "string", format: "binary" } } } }),
    ApiResponse({ status: 201, type: UpdatedProfileResponseDto }),
  );
}
