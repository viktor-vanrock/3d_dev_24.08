import { applyDecorators } from "@nestjs/common";
import { ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { ApiErrorEnvelopeDto } from "../../../nest/openapi/error-envelope.dto.ts";
import { ApiSessionProtected } from "../../../nest/openapi/api-session-protected.ts";
import {
  BalanceResponseDto,
  BillingWebhookResponseDto,
  PayoutDto,
  PayoutsResponseDto,
  PayoutTransitionResponseDto,
  PurchaseCreatedResponseDto,
  PurchaseResponseDto,
  PurchasesResponseDto,
  SalesResponseDto,
} from "./billing.dto.ts";
export function ApiBillingOperation(
  summary: string,
  options?: {
    auth?: boolean;
    created?: boolean;
    response?: "purchase-created" | "webhook" | "purchases" | "purchase" | "sales" | "balance" | "payout" | "payouts" | "payout-transition";
  },
) {
  const responseType =
    options?.response === "purchase-created"
      ? PurchaseCreatedResponseDto
      : options?.response === "webhook"
        ? BillingWebhookResponseDto
        : options?.response === "purchases"
          ? PurchasesResponseDto
          : options?.response === "purchase"
            ? PurchaseResponseDto
            : options?.response === "sales"
              ? SalesResponseDto
              : options?.response === "balance"
                ? BalanceResponseDto
                : options?.response === "payouts"
                  ? PayoutsResponseDto
                  : options?.response === "payout-transition"
                    ? PayoutTransitionResponseDto
                    : PayoutDto;
  return applyDecorators(
    ApiTags("billing"),
    ApiOperation({
      summary,
      description: "Nest migration of the existing Billing HTTP contract.",
    }),
    ...(options?.auth ? [ApiSessionProtected()] : []),
    ApiResponse({
      status: options?.created ? 201 : 200,
      description: "Successful Billing response",
      type: responseType,
    }),
    ApiResponse({ status: 400, type: ApiErrorEnvelopeDto }),
    ApiResponse({ status: 403, type: ApiErrorEnvelopeDto }),
    ApiResponse({ status: 404, type: ApiErrorEnvelopeDto }),
    ApiResponse({ status: 409, type: ApiErrorEnvelopeDto }),
    ApiResponse({ status: 422, type: ApiErrorEnvelopeDto }),
    ApiResponse({ status: 502, type: ApiErrorEnvelopeDto }),
    ApiResponse({ status: 503, type: ApiErrorEnvelopeDto }),
  );
}
