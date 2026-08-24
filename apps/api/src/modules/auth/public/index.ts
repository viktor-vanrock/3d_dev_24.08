import type { UserId } from "../../_kernel/brandedIds.ts";

export const AUTH_IDENTITY_READ_PORT = Symbol("AUTH_IDENTITY_READ_PORT");

export interface AuthIdentityReadPort {
  hasVerifiedIdentity(userId: UserId): Promise<boolean>;
}
export { decryptIdentity, encryptIdentity } from "../infrastructure/auth-crypto.ts";
