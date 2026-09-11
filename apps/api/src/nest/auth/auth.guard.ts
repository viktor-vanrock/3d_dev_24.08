import { Inject, Injectable, UnauthorizedException } from "@nestjs/common";
import type { CanActivate, ExecutionContext } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Reflector } from "@nestjs/core";
import { AccessMode } from "../../modules/permissions/domain/access-mode.ts";
import { ACCESS_MODE_KEY } from "../../modules/permissions/guards/permission.guard.ts";
import { isClosedDev, requiresSession } from "./access-matrix.ts";
import { SESSION_USER, SessionVerifier, type RequestWithSession } from "./session-verifier.ts";

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(ConfigService) private readonly config: ConfigService,
    @Inject(SessionVerifier) private readonly sessions: SessionVerifier,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const mode = this.reflector.getAllAndOverride<AccessMode | undefined>(ACCESS_MODE_KEY, [context.getHandler(), context.getClass()]);
    if (mode === AccessMode.PUBLIC) return true;

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
