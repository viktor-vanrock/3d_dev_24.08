import { BadRequestException, ForbiddenException, Inject, Injectable } from "@nestjs/common";
import type { UserId } from "../../_kernel/brandedIds.ts";
import type { PermissionGrant, PermissionScope } from "../domain/permission-grant.ts";
import type { Permissions } from "../domain/permissions.catalog.ts";

export const PERMISSION_GRANTS_REPOSITORY = Symbol("PERMISSION_GRANTS_REPOSITORY");

// Репозиторий отвечает за атомарную запись grant и его audit-события. Проверка
// применимости scope остаётся в сервисе — это единственная точка решения доступа.
export interface PermissionGrantsRepository {
  isUserActive(userId: UserId): Promise<boolean>;
  findActiveGrants(input: { readonly userId: UserId; readonly permission: Permissions; readonly now: Date }): Promise<readonly PermissionGrant[]>;
  createWithAudit(input: {
    readonly userId: UserId;
    readonly permission: Permissions;
    readonly scope: PermissionScope;
    readonly grantedBy: UserId;
    readonly reason: string;
    readonly expiresAt: Date | null;
  }): Promise<PermissionGrant>;
  revokeWithAudit(input: {
    readonly grantId: string;
    readonly revokedBy: UserId;
    readonly reason: string;
  }): Promise<boolean>;
}

export interface GrantPermissionInput {
  readonly actorId: UserId;
  readonly userId: UserId;
  readonly permission: Permissions;
  readonly scope?: PermissionScope;
  readonly reason: string;
  readonly expiresAt?: Date | null;
}

export interface RevokePermissionInput {
  readonly actorId: UserId;
  readonly grantId: string;
  readonly reason: string;
}

function scopesMatch(grantScope: PermissionScope, requestedScope: PermissionScope | undefined): boolean {
  const entries = Object.entries(grantScope);
  if (entries.length === 0) return true;
  if (requestedScope === undefined) return false;
  return entries.every(([key, value]) => requestedScope[key] === value);
}

@Injectable()
export class PermissionsService {
  constructor(@Inject(PERMISSION_GRANTS_REPOSITORY) private readonly grants: PermissionGrantsRepository) {}

  async isActiveUser(userId: UserId): Promise<boolean> {
    try {
      return await this.grants.isUserActive(userId);
    } catch {
      return false;
    }
  }

  // Fail-closed: отсутствующий/неактивный пользователь, истёкший или отозванный
  // grant, а также несовпадающий scope всегда возвращают false.
  async hasPermission(userId: UserId, permission: Permissions, scope?: PermissionScope): Promise<boolean> {
    try {
      if (!(await this.isActiveUser(userId))) return false;
      const now = new Date();
      const grants = await this.grants.findActiveGrants({ userId, permission, now });
      return grants.some((grant) => {
        if (grant.revokedAt !== null) return false;
        if (grant.expiresAt !== null && grant.expiresAt <= now) return false;
        return scopesMatch(grant.scope, scope);
      });
    } catch {
      return false;
    }
  }

  async grant(input: GrantPermissionInput): Promise<PermissionGrant> {
    if (input.actorId === input.userId) throw new ForbiddenException("Нельзя выдать разрешение самому себе");
    const reason = input.reason.trim();
    if (reason === "") throw new BadRequestException("Необходимо указать причину выдачи разрешения");
    const expiresAt = input.expiresAt ?? null;
    if (expiresAt !== null && expiresAt <= new Date()) throw new BadRequestException("Срок действия разрешения должен быть в будущем");
    return this.grants.createWithAudit({
      userId: input.userId,
      permission: input.permission,
      scope: input.scope ?? {},
      grantedBy: input.actorId,
      reason,
      expiresAt,
    });
  }

  async revoke(input: RevokePermissionInput): Promise<boolean> {
    const reason = input.reason.trim();
    if (reason === "") throw new BadRequestException("Необходимо указать причину отзыва разрешения");
    return this.grants.revokeWithAudit({ grantId: input.grantId, revokedBy: input.actorId, reason });
  }
}
