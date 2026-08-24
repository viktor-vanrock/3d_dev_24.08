import type { UserId } from "../../_kernel/brandedIds.ts";

export const SECURITY_PORT = Symbol("SECURITY_PORT");
export const SECURITY_BOT_SIGNAL_PORT = Symbol("SECURITY_BOT_SIGNAL_PORT");

export interface SecurityRequestIdentity {
  readonly ip: string;
  readonly headers: Readonly<Record<string, string | readonly string[] | undefined>>;
}

export interface SecurityBotSignalPort {
  flag(identity: SecurityRequestIdentity, userId: UserId, reason: "honeypot_click"): void;
}

export interface SecurityPort {
  hitHoneypot(identity: SecurityRequestIdentity, userId: UserId): never;
}
export { checkRateLimit, flagBotSignal, hashIp, serializeRateLimitMetadata, type RateLimitScope } from "../application/rate-limit.ts";
