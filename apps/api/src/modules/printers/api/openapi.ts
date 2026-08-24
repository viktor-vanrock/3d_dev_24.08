import { applyDecorators } from "@nestjs/common";
import { ApiBearerAuth, ApiCookieAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from "@nestjs/swagger";
import type { Type } from "@nestjs/common";
import { ApiErrorEnvelopeDto } from "../../../nest/openapi/error-envelope.dto.ts";
import {
  CommunityFirmwarePageDto,
  CommunityFirmwareResponseDto,
  PrinterConnectRecipeDto,
  PrinterIdentityResponseDto,
  PrinterOkDto,
  PrinterPrusaStatusDto,
  PrinterPrusaSyncDto,
  PrinterReportApprovalDto,
  PrinterReportEnvelopeDto,
  PrinterReportsResponseDto,
  PrinterResearchResponseDto,
  PrinterResearchUploadResponseDto,
  PrinterResearchUpsertResponseDto,
} from "./printers.dto.ts";

const responseType = (summary: string): Type | undefined =>
  ({
    "List community firmware": CommunityFirmwarePageDto,
    "Create community firmware": CommunityFirmwareResponseDto,
    "Update community firmware": CommunityFirmwareResponseDto,
    "Read local printer discovery recipe": PrinterConnectRecipeDto,
    "Identify a local printer": PrinterIdentityResponseDto,
    "Connect Prusa account": PrinterPrusaSyncDto,
    "Synchronize Prusa account": PrinterPrusaSyncDto,
    "Read Prusa connection": PrinterPrusaStatusDto,
    "Disconnect Prusa account": PrinterOkDto,
    "Upsert researched printer": PrinterResearchUpsertResponseDto,
    "Read researched printer": PrinterResearchResponseDto,
    "Create printer media upload": PrinterResearchUploadResponseDto,
    "Report inaccurate printer data": PrinterReportEnvelopeDto,
    "List printer reports": PrinterReportsResponseDto,
    "Reject printer report": PrinterReportEnvelopeDto,
    "Approve printer report": PrinterReportApprovalDto,
  })[summary];

export function ApiPrintersOperation(
  summary: string,
  options: { readonly auth?: boolean; readonly created?: boolean; readonly noContent?: boolean; readonly status?: number } = {},
) {
  const successStatus = options.status ?? (options.noContent ? 204 : options.created ? 201 : 200);
  const successType = responseType(summary);
  return applyDecorators(
    ApiTags("printers"),
    ApiOperation({ summary }),
    ...(options.auth ? [ApiCookieAuth("portal_session"), ApiBearerAuth("bearer")] : []),
    ...(summary === "Read printer research media" ? [ApiParam({ name: "key", type: String, description: "Object storage key, including path segments" })] : []),
    ApiResponse({
      status: successStatus,
      description: successStatus === 302 ? "Redirect to the signed media URL" : "Successful printers-domain response",
      ...(successStatus === 302 ? { headers: { Location: { schema: { type: "string", format: "uri" } } } } : {}),
      ...(successType === undefined || successStatus === 204 || successStatus === 302 ? {} : { type: successType }),
    }),
    ...(summary === "Upsert researched printer" ? [ApiResponse({ status: 201, description: "Created researched printer", type: PrinterResearchUpsertResponseDto })] : []),
    ApiResponse({ status: 401, type: ApiErrorEnvelopeDto }),
    ApiResponse({ status: 403, type: ApiErrorEnvelopeDto }),
    ApiResponse({ status: 404, type: ApiErrorEnvelopeDto }),
    ApiResponse({ status: 422, type: ApiErrorEnvelopeDto }),
  );
}
