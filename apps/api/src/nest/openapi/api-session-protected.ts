import { applyDecorators } from "@nestjs/common";
import { ApiBearerAuth, ApiCookieAuth, ApiUnauthorizedResponse } from "@nestjs/swagger";
import { ApiErrorEnvelopeDto } from "./error-envelope.dto.ts";

export function ApiSessionProtected(): MethodDecorator & ClassDecorator {
  return applyDecorators(
    ApiCookieAuth("portal_session"),
    ApiBearerAuth("bearer"),
    ApiUnauthorizedResponse({
      description: "Session is absent or invalid",
      type: ApiErrorEnvelopeDto,
    }),
  );
}
