import { applyDecorators } from "@nestjs/common";
import { ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { ApiSessionProtected } from "../../../nest/openapi/api-session-protected.ts";
import { ApiErrorEnvelopeDto } from "../../../nest/openapi/error-envelope.dto.ts";
import { MasterEquipmentDeleteResponseDto, MasterEquipmentListResponseDto, MasterEquipmentResponseDto } from "./master-equipment.dto.ts";

export function ApiMasterEquipmentOperation(summary: string, options?: { readonly public?: boolean; readonly created?: boolean; readonly deleted?: boolean }) {
  return applyDecorators(
    ApiTags("master-equipment"),
    ApiOperation({ summary, description: "Nest migration of the existing Master Equipment HTTP contract." }),
    ...(options?.public === true ? [] : [ApiSessionProtected()]),
    ApiResponse({
      status: options?.created === true ? 201 : 200,
      description: "Successful Master Equipment response",
      type: options?.public === true ? MasterEquipmentListResponseDto : options?.deleted === true ? MasterEquipmentDeleteResponseDto : MasterEquipmentResponseDto,
    }),
    ApiResponse({ status: 400, type: ApiErrorEnvelopeDto }),
    ApiResponse({ status: 401, type: ApiErrorEnvelopeDto }),
    ApiResponse({ status: 403, type: ApiErrorEnvelopeDto }),
    ApiResponse({ status: 404, type: ApiErrorEnvelopeDto }),
    ApiResponse({ status: 409, type: ApiErrorEnvelopeDto }),
    ApiResponse({ status: 422, type: ApiErrorEnvelopeDto }),
  );
}
