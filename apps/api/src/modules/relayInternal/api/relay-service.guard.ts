import { createHash, timingSafeEqual } from "node:crypto";
import { HttpStatus, Inject, Injectable, type CanActivate, type ExecutionContext } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Response } from "express";
import { RelayInternalException } from "../domain/relay-internal.error.ts";
import { RELAY_CORRELATION_ID, type RelayInternalRequest } from "./relay-internal.request.ts";

const CORRELATION_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;
const OPERATION_ID = CORRELATION_ID;

function fixedDigest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

export function relayServiceTokensEqual(actual: string, expected: string): boolean {
  return timingSafeEqual(fixedDigest(actual), fixedDigest(expected));
}

@Injectable()
export class RelayServiceGuard implements CanActivate {
  constructor(@Inject(ConfigService) private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const http = context.switchToHttp();
    const request = http.getRequest<RelayInternalRequest>();
    const response = http.getResponse<Response>();
    const correlationId = request.header("x-correlation-id");
    if (correlationId === undefined || !CORRELATION_ID.test(correlationId)) {
      throw new RelayInternalException(HttpStatus.BAD_REQUEST, "relay.validation.invalid.v1", "Valid x-correlation-id header is required");
    }

    request[RELAY_CORRELATION_ID] = correlationId;
    response.setHeader("x-correlation-id", correlationId);

    const expected = this.config.get<string>("RELAY_SERVICE_TOKEN") ?? "";
    const actual = request.header("x-relay-service-token") ?? "";
    if (expected.length < 32 || actual.length < 32 || actual.length > 512 || !relayServiceTokensEqual(actual, expected)) {
      throw new RelayInternalException(HttpStatus.UNAUTHORIZED, "relay.auth.invalid_service_credential.v1", "Invalid relay service credential");
    }

    const operationIdOptional = request.method === "GET" || request.originalUrl.startsWith("/internal/relay/v1/gateways/revalidate");
    const operationId = request.header("x-operation-id");
    if (!operationIdOptional && (operationId === undefined || !OPERATION_ID.test(operationId))) {
      throw new RelayInternalException(HttpStatus.BAD_REQUEST, "relay.validation.invalid.v1", "Valid x-operation-id header is required");
    }
    return true;
  }
}
