import type { UserId } from "../../_kernel/brandedIds.ts";

export const SESSION_COOKIE_NAME = "portal_session";
export const APP_INTENT_COOKIE_NAME = "plagid_app";
/**
 * Explicit exceptions are kept separate from suffixes: this is the extension
 * point for future foreign/corporate domains without changing validation code.
 */
export const ALWAYS_ALLOWED_EMAIL_DOMAINS = ["sberbank.ru", "sberdevices.ru"] as const;
export const ALLOWED_EMAIL_SUFFIXES = [".ru", ".рф"] as const;
export type EmailDomain = string;

export function isAllowedEmailDomain(value: unknown): value is EmailDomain {
  if (typeof value !== "string") return false;
  const domain = value.trim().toLowerCase();
  if (domain === "" || domain.includes("@") || domain.includes(" ")) return false;
  return (ALWAYS_ALLOWED_EMAIL_DOMAINS as readonly string[]).includes(domain)
    || (ALLOWED_EMAIL_SUFFIXES as readonly string[]).some((suffix) => domain.endsWith(suffix));
}

export interface AuthenticatedUser {
  readonly id: UserId;
  readonly username: string;
}

export interface IdentitySeed {
  readonly provider: "email_corp" | "plag_id";
  readonly identifier: string;
  readonly rawClaims: Readonly<Record<string, unknown>>;
}

export interface PlagIdClaims {
  readonly telegramId: number;
  readonly username: string | null;
  readonly firstName: string;
  readonly lastName: string | null;
  readonly photoUrl: string | null;
}

export interface SessionProfileResponse {
  readonly user: {
    readonly id: string;
    readonly username: string;
    readonly display_name: string | null;
    readonly avatar_url: string | null;
    readonly handle_confirmed: boolean;
    readonly role: string;
  };
}
