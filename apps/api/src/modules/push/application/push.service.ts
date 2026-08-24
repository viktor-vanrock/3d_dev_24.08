import { Inject, Injectable } from "@nestjs/common";
import { PUSH_TYPES, type PushPreference, type PushType } from "../domain/push.ts";
import { PushRepository } from "../infrastructure/push.repository.ts";
import { VapidPublicKeyProvider } from "../infrastructure/vapid-public-key.provider.ts";
import { WebPushDelivery } from "../infrastructure/web-push.delivery.ts";
import type { PushPort, PushSubscriptionInput } from "../public/index.ts";
import type { UserId } from "../../_kernel/brandedIds.ts";

@Injectable()
export class PushService implements PushPort {
  constructor(
    @Inject(PushRepository) private readonly repository: PushRepository,
    @Inject(VapidPublicKeyProvider) private readonly vapid: VapidPublicKeyProvider,
    @Inject(WebPushDelivery) private readonly delivery: WebPushDelivery,
  ) {}

  publicKey(): string | null {
    return this.vapid.read();
  }

  async subscribe(userId: UserId, input: PushSubscriptionInput): Promise<void> {
    await this.repository.upsertSubscription(userId, input);
  }

  async unsubscribe(userId: UserId, endpoint: string): Promise<void> {
    await this.repository.deleteSubscription(userId, endpoint);
  }

  async preferences(userId: UserId): Promise<readonly PushPreference[]> {
    const overrides = await this.repository.preferenceOverrides(userId);
    return PUSH_TYPES.map((type) => ({ type, enabled: overrides.get(type) ?? true }));
  }

  async setPreference(userId: UserId, type: PushType, enabled: boolean): Promise<PushPreference> {
    await this.repository.upsertPreference(userId, type, enabled);
    return { type, enabled };
  }

  send(userId: UserId, type: PushType, payload: Parameters<PushPort["send"]>[2]): Promise<void> {
    return this.delivery.send(userId, type, payload);
  }
}
