import { Catch, HttpStatus, type ArgumentsHost, type ExceptionFilter } from "@nestjs/common";
import type { Response } from "express";
import { RelayInternalException, relayErrorEnvelope } from "../domain/relay-internal.error.ts";
import { getRelayCorrelationId, type RelayInternalRequest } from "./relay-internal.request.ts";

@Catch()
export class RelayInternalExceptionFilter implements ExceptionFilter<unknown> {
  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<RelayInternalRequest>();
    const response = http.getResponse<Response>();
    const requestId = getRelayCorrelationId(request);
    const relayException =
      exception instanceof RelayInternalException
        ? exception
        : new RelayInternalException(HttpStatus.INTERNAL_SERVER_ERROR, "relay.internal.v1", "Internal relay service error", true);

    response.setHeader("x-correlation-id", requestId);
    response.status(relayException.getStatus()).json(
      relayErrorEnvelope({
        code: relayException.code,
        message: relayException.safeMessage,
        requestId,
        retryable: relayException.retryable,
        operationId: relayException.operationId,
      }),
    );
  }
}
