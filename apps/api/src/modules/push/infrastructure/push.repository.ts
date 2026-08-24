import { Inject, Injectable } from "@nestjs/common";
import type { Pool } from "pg";
import { DATABASE_POOL } from "../../../nest/database/database.constants.ts";
import type { UserId } from "../../_kernel/brandedIds.ts";
import type { PushSubscriptionInput } from "../public/index.ts";
import type { PushType } from "../domain/push.ts";

@Injectable()
export class PushRepository {
  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {}

  async upsertSubscription(userId: UserId, input: PushSubscriptionInput): Promise<void> {
    await this.pool.query(
      `insert into push_subscriptions (user_id, endpoint, p256dh, auth_key, user_agent)
       values ($1, $2, $3, $4, $5)
       on conflict (endpoint) do update set
         user_id = excluded.user_id, p256dh = excluded.p256dh, auth_key = excluded.auth_key,
         user_agent = excluded.user_agent, last_seen_at = now(), failed_count = 0`,
      [userId, input.endpoint, input.p256dh, input.auth, input.userAgent],
    );
  }

  async deleteSubscription(userId: UserId, endpoint: string): Promise<void> {
    await this.pool.query(`delete from push_subscriptions where user_id = $1 and endpoint = $2`, [userId, endpoint]);
  }

  async preferenceOverrides(userId: UserId): Promise<ReadonlyMap<string, boolean>> {
    const result = await this.pool.query<{ type: string; enabled: boolean }>(`select type, enabled from push_preferences where user_id = $1`, [userId]);
    return new Map(result.rows.map((row) => [row.type, row.enabled]));
  }

  async upsertPreference(userId: UserId, type: PushType, enabled: boolean): Promise<void> {
    await this.pool.query(
      `insert into push_preferences (user_id, type, enabled) values ($1, $2, $3)
       on conflict (user_id, type) do update set enabled = excluded.enabled, updated_at = now()`,
      [userId, type, enabled],
    );
  }

  async deliveryEnabled(userId: UserId, type: PushType): Promise<boolean> {
    const result = await this.pool.query<{ enabled: boolean }>(`select enabled from push_preferences where user_id = $1 and type = $2`, [userId, type]);
    return result.rows[0]?.enabled !== false;
  }

  async deliverySubscriptions(userId: UserId): Promise<readonly { readonly id: string; readonly endpoint: string; readonly p256dh: string; readonly authKey: string }[]> {
    const result = await this.pool.query<{ id: string; endpoint: string; p256dh: string; auth_key: string }>(
      `select id, endpoint, p256dh, auth_key from push_subscriptions where user_id = $1`,
      [userId],
    );
    return result.rows.map((row) => ({ id: row.id, endpoint: row.endpoint, p256dh: row.p256dh, authKey: row.auth_key }));
  }

  async markDeliverySuccess(subscriptionId: string): Promise<void> {
    await this.pool.query(`update push_subscriptions set last_seen_at = now(), failed_count = 0 where id = $1`, [subscriptionId]);
  }

  async deleteDeliverySubscription(subscriptionId: string): Promise<void> {
    await this.pool.query(`delete from push_subscriptions where id = $1`, [subscriptionId]);
  }

  async markDeliveryFailure(subscriptionId: string, pruneThreshold: number): Promise<void> {
    await this.pool.query(`update push_subscriptions set failed_count = failed_count + 1 where id = $1`, [subscriptionId]);
    await this.pool.query(`delete from push_subscriptions where id = $1 and failed_count >= $2`, [subscriptionId, pruneThreshold]);
  }
}
