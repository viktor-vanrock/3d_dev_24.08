import type { Request } from "express";

export const RELAY_CORRELATION_ID = Symbol("RELAY_CORRELATION_ID");

export interface RelayInternalRequest extends Request {
  [RELAY_CORRELATION_ID]?: string;
}

export function getRelayCorrelationId(request: RelayInternalRequest): string {
  return request[RELAY_CORRELATION_ID] ?? "relay-correlation-missing";
}
