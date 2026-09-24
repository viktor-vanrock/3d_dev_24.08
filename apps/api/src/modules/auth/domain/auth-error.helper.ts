import { HttpException, HttpStatus } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { AuthErrorCode } from "./auth-errors.ts";

export function generateTraceId(): string {
  return randomUUID();
}

export function createAuthError(code: AuthErrorCode, message: string, retryable: boolean, status = HttpStatus.BAD_REQUEST): HttpException {
  return new HttpException({ code, message, traceId: generateTraceId(), retryable }, status);
}
