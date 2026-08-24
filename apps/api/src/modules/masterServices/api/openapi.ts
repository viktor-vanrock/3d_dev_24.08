import { applyDecorators } from "@nestjs/common";
import { ApiBody, ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { ApiSessionProtected } from "../../../nest/openapi/api-session-protected.ts";
import { ApiErrorEnvelopeDto } from "../../../nest/openapi/error-envelope.dto.ts";
import { MasterServiceBodyDto, MasterServiceDeleteResponseDto, MasterServiceListResponseDto, MasterServiceResponseDto } from "./master-services.dto.ts";

export function ApiMasterServicesOperation(
  summary: string,
  options: { readonly auth?: boolean; readonly status?: number; readonly body?: boolean; readonly list?: boolean; readonly deleted?: boolean } = {},
): MethodDecorator {
  const responseType = options.list === true ? MasterServiceListResponseDto : options.deleted === true ? MasterServiceDeleteResponseDto : MasterServiceResponseDto;
  const decorators: Array<ClassDecorator | MethodDecorator> = [
    ApiTags("master-services"),
    ApiOperation({ summary }),
    ApiResponse({ status: options.status ?? 200, type: responseType }),
    ApiResponse({ status: 400, type: ApiErrorEnvelopeDto }),
    ApiResponse({ status: 403, type: ApiErrorEnvelopeDto }),
    ApiResponse({ status: 404, type: ApiErrorEnvelopeDto }),
    ApiResponse({ status: 422, type: ApiErrorEnvelopeDto }),
  ];
  if (options.auth === true) decorators.push(ApiSessionProtected());
  if (options.body === true) decorators.push(ApiBody({ type: MasterServiceBodyDto }));
  return applyDecorators(...decorators);
}
