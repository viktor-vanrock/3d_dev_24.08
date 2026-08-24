import { applyDecorators } from "@nestjs/common";
import { ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import { ApiSessionProtected } from "../../../nest/openapi/api-session-protected.ts";
import { AnalyticsHealthDto, ConsentRecordedDto } from "./analytics.dto.ts";

export function ApiConsentOperation(): MethodDecorator {
  return applyDecorators(ApiTags("analytics"), ApiOperation({ summary: "Record or revoke analytics consent" }), ApiCreatedResponse({ type: ConsentRecordedDto }));
}

export function ApiAnalyticsHealthOperation(): MethodDecorator {
  return applyDecorators(
    ApiTags("analytics"),
    ApiOperation({ summary: "Read the product health dashboard snapshot" }),
    ApiOkResponse({ type: AnalyticsHealthDto }),
    ApiSessionProtected(),
  );
}
