import type { UserId } from "../../_kernel/brandedIds.ts";
import type { Permissions } from "./permissions.catalog.ts";

// Scope намеренно хранится как неизменяемый JSON-объект: сервис сопоставляет все
// пары ключ-значение grant со scope конкретного запроса.
export type PermissionScope = Readonly<Record<string, string | number | boolean | null>>;

export interface PermissionGrant {
  readonly id: string;
  readonly userId: UserId;
  readonly permission: Permissions;
  readonly scope: PermissionScope;
  readonly grantedBy: UserId;
  readonly reason: string;
  readonly grantedAt: Date;
  readonly expiresAt: Date | null;
  readonly revokedAt: Date | null;
  readonly revokedBy: UserId | null;
  readonly revokeReason: string | null;
}
