import type { UserId } from "../../_kernel/brandedIds.ts";

export const SESSION_COOKIE_NAME = "portal_session";
export const APP_INTENT_COOKIE_NAME = "plagid_app";
export const EMAIL_DOMAINS = ["sberbank.ru", "sberdevices.ru"] as const;
export type EmailDomain = (typeof EMAIL_DOMAINS)[number];

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
