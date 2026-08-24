import { applyDecorators } from "@nestjs/common";
import {
  ApiBadRequestResponse,
  ApiInternalServerErrorResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from "@nestjs/swagger";
import { ApiErrorEnvelopeDto } from "../../../nest/openapi/error-envelope.dto.ts";
import { DevLoginResponseDto, OkResponseDto, PasswordLoginResponseDto, SessionResponseDto } from "./auth.dto.ts";

const errors = [
  ApiBadRequestResponse({ type: ApiErrorEnvelopeDto }),
  ApiUnauthorizedResponse({ type: ApiErrorEnvelopeDto }),
  ApiTooManyRequestsResponse({ type: ApiErrorEnvelopeDto }),
  ApiInternalServerErrorResponse({ type: ApiErrorEnvelopeDto }),
];

export function ApiSessionOperation(): MethodDecorator {
  return applyDecorators(
    ApiTags("auth"),
    ApiOperation({ summary: "Return the current active user session" }),
    ApiOkResponse({ type: SessionResponseDto }),
    ApiUnauthorizedResponse({ type: ApiErrorEnvelopeDto }),
  );
}

export function ApiLogoutOperation(): MethodDecorator {
  return applyDecorators(ApiTags("auth"), ApiOperation({ summary: "Clear the browser session" }), ApiOkResponse({ type: OkResponseDto }));
}

export function ApiLogoutAllOperation(): MethodDecorator {
  return applyDecorators(
    ApiTags("auth"),
    ApiOperation({ summary: "Revoke all active user sessions" }),
    ApiOkResponse({ type: OkResponseDto }),
    ApiUnauthorizedResponse({ type: ApiErrorEnvelopeDto }),
  );
}

export function ApiEmailStartOperation(): MethodDecorator {
  return applyDecorators(ApiTags("auth"), ApiOperation({ summary: "Send a corporate email OTP" }), ApiOkResponse({ type: OkResponseDto }), ...errors);
}

export function ApiEmailVerifyOperation(): MethodDecorator {
  return applyDecorators(ApiTags("auth"), ApiOperation({ summary: "Verify an email OTP and issue a session" }), ApiOkResponse({ type: OkResponseDto }), ...errors);
}

export function ApiPasswordLoginOperation(): MethodDecorator {
  return applyDecorators(
    ApiTags("auth"),
    ApiOperation({ summary: "Issue a session for a local password credential" }),
    ApiOkResponse({ type: PasswordLoginResponseDto }),
    ApiUnauthorizedResponse({ type: ApiErrorEnvelopeDto }),
    ApiTooManyRequestsResponse({ type: ApiErrorEnvelopeDto }),
  );
}

export function ApiPlagIdStartOperation(): MethodDecorator {
  return applyDecorators(
    ApiTags("auth"),
    ApiOperation({ summary: "Start PlagID login" }),
    ApiResponse({
      status: 302,
      description: "Redirect to PlagID",
      headers: { Location: { required: true, schema: { type: "string", format: "uri" } } },
    }),
  );
}

export function ApiPlagIdCallbackOperation(): MethodDecorator {
  return applyDecorators(
    ApiTags("auth"),
    ApiOperation({ summary: "Complete PlagID login" }),
    ApiResponse({
      status: 302,
      description: "Redirect to the web or native application",
      headers: { Location: { required: true, schema: { type: "string", format: "uri" } } },
    }),
    ApiUnauthorizedResponse({ type: ApiErrorEnvelopeDto }),
    ApiInternalServerErrorResponse({ type: ApiErrorEnvelopeDto }),
  );
}

export function ApiSberIdStubOperation(): MethodDecorator {
  return applyDecorators(ApiTags("auth"), ApiOperation({ summary: "SberID integration status" }), ApiResponse({ status: 501, type: ApiErrorEnvelopeDto }));
}

export function ApiDevLoginOperation(): MethodDecorator {
  return applyDecorators(
    ApiTags("auth"),
    ApiOperation({ summary: "Issue the explicitly enabled non-production developer session" }),
    ApiOkResponse({ type: DevLoginResponseDto }),
    ApiNotFoundResponse({ type: ApiErrorEnvelopeDto }),
    ApiInternalServerErrorResponse({ type: ApiErrorEnvelopeDto }),
  );
}
