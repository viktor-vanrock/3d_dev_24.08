import { Inject, Injectable, UnauthorizedException } from "@nestjs/common";
import type { CanActivate, ExecutionContext } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { isClosedDev, requiresSession } from "./access-matrix.ts";
import { SESSION_USER, SessionVerifier, type RequestWithSession } from "./session-verifier.ts";

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    @Inject(ConfigService) private readonly config: ConfigService,
    @Inject(SessionVerifier) private readonly sessions: SessionVerifier,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithSession>();
    const closedDev = isClosedDev({
      CLOSED_DEV: this.config.get<string>("CLOSED_DEV"),
      PORTAL_PUBLIC: this.config.get<string>("PORTAL_PUBLIC"),
    });
    if (!requiresSession({ method: request.method, url: request.originalUrl, closedDev })) return true;

    const session = await this.sessions.readSession(request);
    if (session === null) throw new UnauthorizedException();
    request[SESSION_USER] = session;
    return true;
  }
}
