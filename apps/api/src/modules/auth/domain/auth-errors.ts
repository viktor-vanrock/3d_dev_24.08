export const AUTH_ERRORS = {
  INVALID_CODE: "auth.invalid_code.v1",
  CODE_EXPIRED: "auth.code_expired.v1",
  TOO_MANY_ATTEMPTS: "auth.too_many_attempts.v1",
  ACCOUNT_BLOCKED: "auth.account_blocked.v1",
  EMAIL_NOT_SUPPORTED: "auth.email_not_supported.v1",
  EMAIL_TAKEN: "auth.email_taken.v1",
  INVALID_PASSWORD: "auth.invalid_password.v1",
  ACCOUNT_NOT_FOUND: "auth.account_not_found.v1",
  SESSION_NOT_FOUND: "auth.session_not_found.v1",
  FORBIDDEN: "auth.forbidden.v1",
} as const;

export type AuthErrorCode = (typeof AUTH_ERRORS)[keyof typeof AUTH_ERRORS];
