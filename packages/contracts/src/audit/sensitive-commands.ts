export const SENSITIVE_COMMANDS = [
  "auth.login.success", "auth.login.failed", "auth.logout", "auth.logout_all", "auth.password_reset",
  "session.created", "session.revoked", "api_key.issued", "api_key.revoked", "permission.granted",
  "permission.revoked", "sanction.created", "sanction.cancelled", "sanction.expired", "project.published",
  "project.unpublished", "project.archived", "project.restored", "moderation.decision", "moderation.appeal",
  "device.enrolled", "device.revoked",
  "audit.exported", "audit.legal_hold",
] as const;

export type SensitiveCommand = (typeof SENSITIVE_COMMANDS)[number];

/** Forces registry consumers to make an explicit choice for every sensitive command. */
export const AUDIT_COVERAGE = {
  "auth.login.success": true, "auth.login.failed": true, "auth.logout": true, "auth.logout_all": true, "auth.password_reset": true,
  "session.created": true, "session.revoked": true, "api_key.issued": true, "api_key.revoked": true, "permission.granted": true,
  "permission.revoked": true, "sanction.created": true, "sanction.cancelled": true, "sanction.expired": true, "project.published": true,
  "project.unpublished": true, "project.archived": true, "project.restored": true, "moderation.decision": true, "moderation.appeal": true,
  "device.enrolled": true, "device.revoked": true,
  "audit.exported": true, "audit.legal_hold": true,
} satisfies { [K in SensitiveCommand]: true };
