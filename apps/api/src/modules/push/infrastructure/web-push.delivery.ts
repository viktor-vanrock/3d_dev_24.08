import { Inject, Injectable } from "@nestjs/common";
import webpush from "web-push";
import type { UserId } from "../../_kernel/brandedIds.ts";
import type { PushPayload, PushType } from "../domain/push.ts";
import { PushRepository } from "./push.repository.ts";

const FAILED_COUNT_PRUNE_THRESHOLD = 5;
let configured: boolean | undefined;

function isConfigured(): boolean {
  if (configured !== undefined) return configured;
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  configured = publicKey !== undefined && publicKey !== "" && privateKey !== undefined && privateKey !== "";
  if (configured) {
    webpush.setVapidDetails(process.env.VAPID_SUBJECT ?? "mailto:ops@3mf.tech", publicKey!, privateKey!);
  }
  return configured;
}

@Injectable()
export class WebPushDelivery {
  constructor(@Inject(PushRepository) private readonly repository: PushRepository) {}

  async send(userId: UserId, type: PushType, payload: PushPayload): Promise<void> {
    if (!isConfigured() || !(await this.repository.deliveryEnabled(userId, type))) return;
    const subscriptions = await this.repository.deliverySubscriptions(userId);
    await Promise.all(
      subscriptions.map(async (subscription) => {
        try {
          await webpush.sendNotification(
            { endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.authKey } },
            JSON.stringify({ type, ...payload }),
          );
          await this.repository.markDeliverySuccess(subscription.id);
        } catch (error) {
          const statusCode = (error as { readonly statusCode?: number }).statusCode;
          if (statusCode === 404 || statusCode === 410) {
            await this.repository.deleteDeliverySubscription(subscription.id);
            return;
          }
          await this.repository.markDeliveryFailure(subscription.id, FAILED_COUNT_PRUNE_THRESHOLD);
        }
      }),
    );
  }
}

export { webpush };
