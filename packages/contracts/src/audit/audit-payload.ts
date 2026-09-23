export type ForbiddenFields = "password" | "token" | "cookie" | "secret" | "verificationCode";

/** Metadata safe to persist in the audit trail. Runtime validation is still required for dynamic data. */
export type AuditPayload = Record<string, unknown> & { [K in ForbiddenFields]?: never };
