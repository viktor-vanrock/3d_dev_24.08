import { randomUUID } from "node:crypto";
import type { Request } from "express";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const REQUEST_ID = Symbol("REQUEST_ID");

export interface RequestWithId extends Request {
  [REQUEST_ID]?: string;
}

export function resolveRequestId(candidate: string | undefined): string {
  return candidate !== undefined && UUID.test(candidate) ? candidate : randomUUID();
}

export function getRequestId(request: RequestWithId): string {
  const existing = request[REQUEST_ID];
  if (existing !== undefined) return existing;

  const generated = resolveRequestId(request.header("x-request-id"));
  request[REQUEST_ID] = generated;
  return generated;
}
