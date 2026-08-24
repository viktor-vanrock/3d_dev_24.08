import { ApiProperty } from "@nestjs/swagger";
import { API_ERROR_CODES } from "@portal/contracts/http/error-envelope";
import type { ApiError, ApiErrorCode, ApiErrorEnvelope } from "@portal/contracts/http/error-envelope";

export class ApiErrorDto implements ApiError {
  @ApiProperty({
    type: String,
    enum: API_ERROR_CODES,
    description: "Stable, versioned machine-readable error code",
    example: "auth.unauthorized.v1",
  })
  declare readonly code: ApiErrorCode;

  @ApiProperty({ type: String, description: "Safe user-facing error message", example: "Требуется авторизация" })
  declare readonly message: string;

  @ApiProperty({
    type: String,
    description: "Correlation identifier returned in the x-request-id header",
    format: "uuid",
    example: "11111111-1111-4111-8111-111111111111",
  })
  declare readonly requestId: string;
}

export class ApiErrorEnvelopeDto implements ApiErrorEnvelope {
  @ApiProperty({ type: () => ApiErrorDto })
  declare readonly error: ApiErrorDto;
}
