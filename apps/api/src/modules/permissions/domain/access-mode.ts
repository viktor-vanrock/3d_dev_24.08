// Режим доступа объявляется у каждого HTTP-метода контроллера. Отсутствие
// декларации запрещено глобальным PermissionGuard по принципу fail-closed.
export enum AccessMode {
  PUBLIC = "PUBLIC",
  USER = "USER",
  USER_OR_AGENT = "USER_OR_AGENT",
  PERMISSION = "PERMISSION",
  INTERNAL = "INTERNAL",
}
