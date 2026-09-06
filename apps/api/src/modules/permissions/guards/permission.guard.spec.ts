import { ForbiddenException, UnauthorizedException } from "@nestjs/common";
import type { ExecutionContext } from "@nestjs/common";
import type { Reflector } from "@nestjs/core";
import { describe, expect, it, vi } from "vitest";
import { SESSION_USER } from "../../../nest/auth/session-verifier.ts";
import { UserId } from "../../_kernel/brandedIds.ts";
import type { FeedAgentAuthPort } from "../../feed/public/index.ts";
import type { SessionVerifier } from "../../../nest/auth/session-verifier.ts";
import type { PermissionsService } from "../application/permissions.service.ts";
import { AccessMode } from "../domain/access-mode.ts";
import { Permissions } from "../domain/permissions.catalog.ts";
import { ACCESS_MODE_KEY, PermissionGuard, REQUIRED_PERMISSION_KEY } from "./permission.guard.ts";

function context(): ExecutionContext {
  function handler(): void {}
  const controller = class ExampleController {};
  const request = { [SESSION_USER]: { id: "00000000-0000-4000-8000-000000000001" }, headers: {} };
  return {
    getHandler: () => handler,
    getClass: () => controller,
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

function reflector(values: ReadonlyMap<string, unknown>): Reflector {
  return { getAllAndOverride: vi.fn((key: string) => values.get(key)) } as unknown as Reflector;
}

function service(input: { active?: boolean; allowed?: boolean } = {}): PermissionsService {
  return {
    isActiveUser: vi.fn().mockResolvedValue(input.active ?? true),
    hasPermission: vi.fn().mockResolvedValue(input.allowed ?? true),
  } as unknown as PermissionsService;
}

function sessions(): SessionVerifier {
  return { readSession: vi.fn().mockResolvedValue(null) } as unknown as SessionVerifier;
}

function agentAuth(valid = false): FeedAgentAuthPort {
  return { verifyAgentContentToken: vi.fn().mockResolvedValue(valid ? { userId: UserId("00000000-0000-4000-8000-000000000001"), coAuthorAgentId: null } : null) };
}

describe("PermissionGuard", () => {
  it("отказывает методу без декларации доступа с именем controller и handler", async () => {
    const guard = new PermissionGuard(reflector(new Map()), service(), sessions(), agentAuth());

    await expect(guard.canActivate(context())).rejects.toThrow("Метод ExampleController.handler не имеет декларации доступа");
  });

  it("пропускает public и internal маршруты без grant", async () => {
    for (const mode of [AccessMode.PUBLIC, AccessMode.INTERNAL]) {
      const guard = new PermissionGuard(reflector(new Map([[ACCESS_MODE_KEY, mode]])), service(), sessions(), agentAuth());
      await expect(guard.canActivate(context())).resolves.toBe(true);
    }
  });

  it("требует активную сессию для user маршрута", async () => {
    const activeService = service({ active: false });
    const guard = new PermissionGuard(reflector(new Map([[ACCESS_MODE_KEY, AccessMode.USER]])), activeService, sessions(), agentAuth());

    await expect(guard.canActivate(context())).resolves.toBe(false);
  });

  it("отказывает при отсутствии сессии у permission маршрута", async () => {
    const guardedContext = context();
    delete guardedContext.switchToHttp().getRequest<Record<PropertyKey, unknown>>()[SESSION_USER];
    const guard = new PermissionGuard(
      reflector(new Map<string, unknown>([[ACCESS_MODE_KEY, AccessMode.PERMISSION], [REQUIRED_PERMISSION_KEY, Permissions.AUDIT_VIEW_LOG]])),
      service(),
      sessions(),
      agentAuth(),
    );

    await expect(guard.canActivate(guardedContext)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it("отказывает когда сервис не подтвердил разрешение", async () => {
    const guard = new PermissionGuard(
      reflector(new Map<string, unknown>([[ACCESS_MODE_KEY, AccessMode.PERMISSION], [REQUIRED_PERMISSION_KEY, Permissions.AUDIT_VIEW_LOG]])),
      service({ allowed: false }),
      sessions(),
      agentAuth(),
    );

    await expect(guard.canActivate(context())).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("пропускает активную сессию в режиме user-or-agent", async () => {
    const guard = new PermissionGuard(
      reflector(new Map([[ACCESS_MODE_KEY, AccessMode.USER_OR_AGENT]])),
      service({ active: true }),
      sessions(),
      agentAuth(),
    );

    await expect(guard.canActivate(context())).resolves.toBe(true);
  });

  it("пропускает действующий агентский токен в режиме user-or-agent", async () => {
    const guardedContext = context();
    const request = guardedContext.switchToHttp().getRequest<{ [SESSION_USER]?: unknown; headers: { authorization?: string } }>();
    delete request[SESSION_USER];
    request.headers.authorization = "Bearer agent-token";
    const guard = new PermissionGuard(
      reflector(new Map([[ACCESS_MODE_KEY, AccessMode.USER_OR_AGENT]])),
      service(),
      sessions(),
      agentAuth(true),
    );

    await expect(guard.canActivate(guardedContext)).resolves.toBe(true);
  });

  it("отказывает без сессии и агентского токена в режиме user-or-agent", async () => {
    const guardedContext = context();
    delete guardedContext.switchToHttp().getRequest<Record<PropertyKey, unknown>>()[SESSION_USER];
    const guard = new PermissionGuard(
      reflector(new Map([[ACCESS_MODE_KEY, AccessMode.USER_OR_AGENT]])),
      service(),
      sessions(),
      agentAuth(),
    );

    await expect(guard.canActivate(guardedContext)).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
