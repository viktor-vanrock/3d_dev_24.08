import { ForbiddenException, Inject, Injectable, UnauthorizedException } from "@nestjs/common";
import type { CanActivate, ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { SESSION_USER, SessionVerifier, type RequestWithSession } from "../../../nest/auth/session-verifier.ts";
import { UserId } from "../../_kernel/brandedIds.ts";
import { FEED_AGENT_AUTH_PORT, type FeedAgentAuthPort } from "../../feed/public/index.ts";
import { PermissionsService } from "../application/permissions.service.ts";
import type { PermissionScope } from "../domain/permission-grant.ts";
import { AccessMode } from "../domain/access-mode.ts";
import type { Permissions } from "../domain/permissions.catalog.ts";

export const ACCESS_MODE_KEY = "permissions:access-mode";
export const REQUIRED_PERMISSION_KEY = "permissions:required-permission";
export const PERMISSION_SCOPE_KEY = "permissions:scope";

function bearer(header: string | string[] | undefined): string | null {
  const value = Array.isArray(header) ? header[0] : header;
  return value === undefined ? null : (/^Bearer (\S+)$/.exec(value)?.[1] ?? null);
}

@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly permissions: PermissionsService,
    @Inject(SessionVerifier) private readonly sessions: SessionVerifier,
    @Inject(FEED_AGENT_AUTH_PORT) private readonly agentAuth: FeedAgentAuthPort,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const mode = this.reflector.getAllAndOverride<AccessMode | undefined>(ACCESS_MODE_KEY, [context.getHandler(), context.getClass()]);
    if (mode === undefined) {
      const controller = context.getClass().name;
      const handler = context.getHandler().name;
      throw new Error(
        `[PermissionGuard] Метод ${controller}.${handler} не имеет декларации доступа. ` +
          "Добавьте @Public(), @User(), @UserOrAgent(), @Permission() или @Internal().",
      );
    }
    if (mode === AccessMode.PUBLIC || mode === AccessMode.INTERNAL) return true;

    const request = context.switchToHttp().getRequest<RequestWithSession>();
    const session = request[SESSION_USER] ?? await this.sessions.readSession(request);
    if (session !== null && session !== undefined) request[SESSION_USER] = session;
    if (mode === AccessMode.USER_OR_AGENT) {
      if (session !== null && session !== undefined) return this.permissions.isActiveUser(UserId(session.id));
      const token = bearer(request.headers.authorization);
      if (token !== null && await this.agentAuth.verifyAgentContentToken(token) !== null) return true;
      throw new UnauthorizedException();
    }
    if (session === null || session === undefined) throw new UnauthorizedException();
    const userId = UserId(session.id);
    if (mode === AccessMode.USER) return this.permissions.isActiveUser(userId);

    const permission = this.reflector.getAllAndOverride<Permissions | undefined>(REQUIRED_PERMISSION_KEY, [context.getHandler(), context.getClass()]);
    if (permission === undefined) throw new Error("[PermissionGuard] Для режима PERMISSION не задано разрешение.");
    const scope = this.reflector.getAllAndOverride<PermissionScope | undefined>(PERMISSION_SCOPE_KEY, [context.getHandler(), context.getClass()]);
    const allowed = await this.permissions.hasPermission(userId, permission, scope);
    if (!allowed) throw new ForbiddenException();
    return true;
  }
}
