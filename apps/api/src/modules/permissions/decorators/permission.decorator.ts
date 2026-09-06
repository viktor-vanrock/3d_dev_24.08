import { applyDecorators, SetMetadata } from "@nestjs/common";
import type { PermissionScope } from "../domain/permission-grant.ts";
import type { Permissions } from "../domain/permissions.catalog.ts";
import { AccessMode } from "../domain/access-mode.ts";
import { ACCESS_MODE_KEY, PERMISSION_SCOPE_KEY, REQUIRED_PERMISSION_KEY } from "../guards/permission.guard.ts";

// Scope передаётся статически на route; ресурсные scope контроллер проверяет
// явно через PermissionsService, когда значение приходит из path/body.
export const Permission = (permission: Permissions, scope?: PermissionScope) =>
  applyDecorators(
    SetMetadata(ACCESS_MODE_KEY, AccessMode.PERMISSION),
    SetMetadata(REQUIRED_PERMISSION_KEY, permission),
    ...(scope !== undefined ? [SetMetadata(PERMISSION_SCOPE_KEY, scope)] : []),
  );
