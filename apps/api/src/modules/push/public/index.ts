import type { PushPayload, PushPreference, PushType } from "../domain/push.ts";
import type { UserId } from "../../_kernel/brandedIds.ts";

export const PUSH_PORT = Symbol("PUSH_PORT");

export interface PushSubscriptionInput {
  readonly endpoint: string;
  readonly p256dh: string;
  readonly auth: string;
  readonly userAgent: string | null;
}

export interface PushPort {
  publicKey(): string | null;
  subscribe(userId: UserId, input: PushSubscriptionInput): Promise<void>;
  unsubscribe(userId: UserId, endpoint: string): Promise<void>;
  preferences(userId: UserId): Promise<readonly PushPreference[]>;
  setPreference(userId: UserId, type: PushType, enabled: boolean): Promise<PushPreference>;
  send(userId: UserId, type: PushType, payload: PushPayload): Promise<void>;
}

export type { PushPayload, PushPreference, PushType };
