import { applyDecorators } from "@nestjs/common";
import { ApiBearerAuth, ApiCookieAuth, ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { ApiErrorEnvelopeDto } from "../../../nest/openapi/error-envelope.dto.ts";
import {
  CandidateCreateDto,
  CandidateMutationDto,
  CandidatePageDto,
  CatalogMachineDetailDto,
  CatalogMachinesDto,
  CatalogMaterialDetailDto,
  CatalogMaterialsDto,
  CatalogMetricsDto,
  CatalogReleasesDto,
  CatalogVendorsDto,
  PrinterCatalogDto,
  PrinterDetailDto,
} from "./catalog.dto.ts";

const responseType = (summary: string) =>
  ({
    "List printer release events": CatalogReleasesDto,
    "List catalog materials": CatalogMaterialsDto,
    "Read a catalog material": CatalogMaterialDetailDto,
    "List catalog vendors": CatalogVendorsDto,
    "List catalog machines": CatalogMachinesDto,
    "Read a catalog machine": CatalogMachineDetailDto,
    "List the public printer catalog": PrinterCatalogDto,
    "Read a public printer catalog card": PrinterDetailDto,
    "Read catalog coverage metrics": CatalogMetricsDto,
    "List material candidates": CandidatePageDto,
    "Suggest a material candidate": CandidateCreateDto,
    "Approve a material candidate": CandidateMutationDto,
    "Reject a material candidate": CandidateMutationDto,
    "List machine candidates": CandidatePageDto,
    "Suggest a machine candidate": CandidateCreateDto,
    "Approve a machine candidate": CandidateMutationDto,
    "Reject a machine candidate": CandidateMutationDto,
  })[summary];

export function ApiCatalogRead(summary: string, authenticated = false, successStatus = 200) {
  return applyDecorators(
    ApiTags("catalog"),
    ApiOperation({ summary }),
    ...(authenticated ? [ApiCookieAuth("portal_session"), ApiBearerAuth("bearer")] : []),
    ApiResponse({ status: successStatus, description: "Successful catalog response", type: responseType(summary) }),
    ApiResponse({ status: 400, type: ApiErrorEnvelopeDto }),
    ApiResponse({ status: 401, type: ApiErrorEnvelopeDto }),
    ApiResponse({ status: 404, type: ApiErrorEnvelopeDto }),
    ApiResponse({ status: 409, type: ApiErrorEnvelopeDto }),
    ApiResponse({ status: 422, type: ApiErrorEnvelopeDto }),
  );
}
