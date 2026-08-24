import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { pool } from "../../../db/client.ts";
import { UserId } from "../../_kernel/brandedIds.ts";
import { PushRepository } from "./push.repository.ts";
import { WebPushDelivery, webpush } from "./web-push.delivery.ts";

const delivery = new WebPushDelivery(new PushRepository(pool));

async function createUser(label: string): Promise<string> {
  const result = await pool.query<{ id: string }>(`insert into users (username) values ($1) returning id`, [`${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`]);
  return result.rows[0]!.id;
}

async function dropUser(userId: string): Promise<void> {
  await pool.query(`delete from users where id = $1`, [userId]);
}

async function addSubscription(userId: string, endpoint: string, failedCount = 0): Promise<void> {
  await pool.query(`insert into push_subscriptions (user_id, endpoint, p256dh, auth_key, failed_count) values ($1, $2, 'p', 'a', $3)`, [userId, endpoint, failedCount]);
}

// Реальные (валидные по формату) VAPID-ключи для теста — webpush.setVapidDetails проверяет
// формат ключа синхронно при первом вызове isPushConfigured(), рандомные строки бы упали там.
describe("sendPush", () => {
  beforeAll(() => {
    const keys = webpush.generateVAPIDKeys();
    process.env.VAPID_PUBLIC_KEY = keys.publicKey;
    process.env.VAPID_PRIVATE_KEY = keys.privateKey;
  });
  afterAll(() => {
    delete process.env.VAPID_PUBLIC_KEY;
    delete process.env.VAPID_PRIVATE_KEY;
  });

  it("skips delivery when the user disabled this type (push_preferences)", async () => {
    const userId = await createUser("push-send-disabled");
    try {
      const endpoint = `https://push.example/ep-${Date.now()}`;
      await addSubscription(userId, endpoint);
      await pool.query(`insert into push_preferences (user_id, type, enabled) values ($1, 'comment', false)`, [userId]);

      const spy = vi.spyOn(webpush, "sendNotification").mockResolvedValue({} as never);
      await delivery.send(UserId(userId), "comment", { title: "t", body: "b", deepLink: "/x" });
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    } finally {
      await dropUser(userId);
    }
  });

  it("delivers on success and resets failed_count/last_seen_at", async () => {
    const userId = await createUser("push-send-ok");
    try {
      const endpoint = `https://push.example/ep-${Date.now()}`;
      await addSubscription(userId, endpoint, 3);

      const spy = vi.spyOn(webpush, "sendNotification").mockResolvedValue({} as never);
      await delivery.send(UserId(userId), "like", { title: "t", body: "b", deepLink: "/x" });
      expect(spy).toHaveBeenCalledTimes(1);

      const row = await pool.query<{ failed_count: number }>(`select failed_count from push_subscriptions where endpoint = $1`, [endpoint]);
      expect(row.rows[0]!.failed_count).toBe(0);
      spy.mockRestore();
    } finally {
      await dropUser(userId);
    }
  });

  it("deletes the subscription immediately on a 410 Gone (dead endpoint)", async () => {
    const userId = await createUser("push-send-410");
    try {
      const endpoint = `https://push.example/ep-${Date.now()}`;
      await addSubscription(userId, endpoint);

      const err = Object.assign(new Error("gone"), { statusCode: 410 });
      const spy = vi.spyOn(webpush, "sendNotification").mockRejectedValue(err);
      await delivery.send(UserId(userId), "like", { title: "t", body: "b", deepLink: "/x" });

      const row = await pool.query(`select 1 from push_subscriptions where endpoint = $1`, [endpoint]);
      expect(row.rowCount).toBe(0);
      spy.mockRestore();
    } finally {
      await dropUser(userId);
    }
  });

  it("prunes a subscription after repeated non-410 failures reach the threshold", async () => {
    const userId = await createUser("push-send-flaky");
    try {
      const endpoint = `https://push.example/ep-${Date.now()}`;
      await addSubscription(userId, endpoint, 4); // +1 в этом вызове = 5 = порог чистки

      const spy = vi.spyOn(webpush, "sendNotification").mockRejectedValue(new Error("network blip"));
      await delivery.send(UserId(userId), "like", { title: "t", body: "b", deepLink: "/x" });

      const row = await pool.query(`select 1 from push_subscriptions where endpoint = $1`, [endpoint]);
      expect(row.rowCount).toBe(0);
      spy.mockRestore();
    } finally {
      await dropUser(userId);
    }
  });

  it("keeps a subscription after a single non-410 failure below the threshold", async () => {
    const userId = await createUser("push-send-blip");
    try {
      const endpoint = `https://push.example/ep-${Date.now()}`;
      await addSubscription(userId, endpoint, 0);

      const spy = vi.spyOn(webpush, "sendNotification").mockRejectedValue(new Error("network blip"));
      await delivery.send(UserId(userId), "like", { title: "t", body: "b", deepLink: "/x" });

      const row = await pool.query<{ failed_count: number }>(`select failed_count from push_subscriptions where endpoint = $1`, [endpoint]);
      expect(row.rows[0]!.failed_count).toBe(1);
      spy.mockRestore();
    } finally {
      await dropUser(userId);
    }
  });
});
