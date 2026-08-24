import { HttpException } from "@nestjs/common";
import type { RelayInternalErrorCode, RelayInternalErrorEnvelopeDto } from "@portal/contracts/http/relay-internal.v1.dto";

export class RelayInternalException extends HttpException {
  constructor(
    status: number,
    readonly code: RelayInternalErrorCode,
    readonly safeMessage: string,
    readonly retryable = false,
    readonly operationId?: string,
  ) {
    super(safeMessage, status);
  }
}

export function relayErrorEnvelope(input: {
  readonly code: RelayInternalErrorCode;
  readonly message: string;
  readonly requestId: string;
  readonly retryable: boolean;
  readonly operationId?: string;
}): RelayInternalErrorEnvelopeDto {
  return {
    error: {
      code: input.code,
      message: input.message,
      request_id: input.requestId,
      retryable: input.retryable,
      ...(input.operationId === undefined ? {} : { operation_id: input.operationId }),
    },
  };
}
