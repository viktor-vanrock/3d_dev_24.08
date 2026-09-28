import { HttpException, HttpStatus } from "@nestjs/common";
import type { AuthErrorCode } from "./auth-errors.ts";

export function createAuthError(code: AuthErrorCode, message: string, retryable: boolean, status = HttpStatus.BAD_REQUEST): HttpException {
  // The global exception filter adds the request's x-request-id to every error.
  return new HttpException({ code, message, retryable }, status);
}
