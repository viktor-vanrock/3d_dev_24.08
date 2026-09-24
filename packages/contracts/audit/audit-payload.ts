export type ForbiddenFields = "password" | "token" | "cookie" | "secret" | "verificationCode";

export type AuditPayload = Record<string, unknown> & { [K in ForbiddenFields]?: never };
