import { HttpException, HttpStatus } from "@nestjs/common";
import type { Request } from "express";
import { checkRateLimit, type RateLimitScope } from "../../modules/security/public/index.ts";

function requestIdentity(request: Request): { readonly ip: string; readonly headers: Request["headers"] } {
  return { ip: request.ip ?? request.socket.remoteAddress ?? "unknown", headers: request.headers };
}

export async function assertNestRateLimit(request: Request, scope: RateLimitScope, userId: string | null): Promise<void> {
  const outcome = checkRateLimit(requestIdentity(request), scope, userId);
  if (outcome.limited) throw new HttpException("", HttpStatus.TOO_MANY_REQUESTS);
  if (outcome.slowdownMs !== undefined && outcome.slowdownMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, outcome.slowdownMs));
  }
}
