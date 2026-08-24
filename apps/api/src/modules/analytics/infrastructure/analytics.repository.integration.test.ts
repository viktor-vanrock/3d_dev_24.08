import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { pool } from "../../../db/client.ts";
import { UserId } from "../../_kernel/brandedIds.ts";
import { AnalyticsService } from "../application/analytics.service.ts";
import { AnalyticsRepository } from "./analytics.repository.ts";

const analytics = new AnalyticsService(new AnalyticsRepository(pool));

async function grantConsent(subject: { anonId?: string | null; userId?: string | null }): Promise<void> {
  await pool.query(
    `insert into consent_records (anon_id, user_id, consent_type, version, action)
     values ($1, $2, 'behavioral_analytics', 'v1', 'granted')`,
    [subject.anonId ?? null, subject.userId ?? null],
  );
}

async function eventsFor(anonId: string | null, userId: string | null): Promise<Array<{ event_name: string; anon_id: string | null; user_id: string | null }>> {
  const result = await pool.query<{ event_name: string; anon_id: string | null; user_id: string | null }>(
    `select event_name, anon_id, user_id from events
     where ($1::text is not null and anon_id = $1) or ($2::uuid is not null and user_id = $2)
     order by created_at asc`,
    [anonId, userId],
  );
  return result.rows;
}

describe("emitEvent — fail-closed consent gate (MF-609, 152-ФЗ)", () => {
  it("does not write a row when there is no granted consent for the subject", async () => {
    const anonId = `anon-${randomUUID()}`;
    try {
      await analytics.emitEvent({ eventName: "model_view", anonId, userId: null, props: { model_id: "x" } });
      const rows = await eventsFor(anonId, null);
      expect(rows).toHaveLength(0);
    } finally {
      await pool.query(`delete from events where anon_id = $1`, [anonId]);
      await pool.query(`delete from consent_records where anon_id = $1`, [anonId]);
    }
  });

  it("does not write a row once consent was revoked after being granted", async () => {
    const anonId = `anon-${randomUUID()}`;
    try {
      await grantConsent({ anonId });
      await pool.query(`insert into consent_records (anon_id, consent_type, version, action) values ($1, 'behavioral_analytics', 'v1', 'revoked')`, [anonId]);
      await analytics.emitEvent({ eventName: "model_view", anonId, userId: null, props: {} });
      const rows = await eventsFor(anonId, null);
      expect(rows).toHaveLength(0);
    } finally {
      await pool.query(`delete from events where anon_id = $1`, [anonId]);
      await pool.query(`delete from consent_records where anon_id = $1`, [anonId]);
    }
  });

  it("writes a row once consent is granted", async () => {
    const anonId = `anon-${randomUUID()}`;
    try {
      await grantConsent({ anonId });
      await analytics.emitEvent({ eventName: "model_view", anonId, userId: null, props: { model_id: "x" } });
      const rows = await eventsFor(anonId, null);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.event_name).toBe("model_view");
      expect(rows[0]!.anon_id).toBe(anonId);
      expect(rows[0]!.user_id).toBeNull();
    } finally {
      await pool.query(`delete from events where anon_id = $1`, [anonId]);
      await pool.query(`delete from consent_records where anon_id = $1`, [anonId]);
    }
  });
});

describe("emitEvent — identify-merge (MF-609, docs/epics/analytics.events.md § «Identify-merge»)", () => {
  it("anon-only events are not rewritten once the same anon_id gets a user_id on later events", async () => {
    const anonId = `anon-${randomUUID()}`;
    let userId: string | null = null;
    try {
      const userResult = await pool.query<{ id: string }>(`insert into users (username) values ($1) returning id`, [`identify-test-${Date.now()}`]);
      userId = userResult.rows[0]!.id;

      // Consent granted anonymously, before any login.
      await grantConsent({ anonId });

      // 1. Аноним: событие пишется только с anon_id.
      await analytics.emitEvent({ eventName: "model_view", anonId, userId: null, props: { model_id: "a" } });

      // 2. Логин (identify): то же устройство, теперь известен и user_id — событие несёт оба id.
      await analytics.emitEvent({ eventName: "model_view", anonId, userId: UserId(userId), props: { model_id: "b" } });

      const rows = await eventsFor(anonId, userId);
      expect(rows).toHaveLength(2);
      expect(rows[0]!.anon_id).toBe(anonId);
      expect(rows[0]!.user_id).toBeNull(); // прошлая (анонимная) строка не переписана
      expect(rows[1]!.anon_id).toBe(anonId);
      expect(rows[1]!.user_id).toBe(userId); // новая строка несёт оба id
    } finally {
      await pool.query(`delete from events where anon_id = $1`, [anonId]);
      await pool.query(`delete from consent_records where anon_id = $1`, [anonId]);
      if (userId) await pool.query(`delete from users where id = $1`, [userId]);
    }
  });

  it("consent granted anonymously still gates events emitted after identify-merge", async () => {
    const anonId = `anon-${randomUUID()}`;
    let userId: string | null = null;
    try {
      const userResult = await pool.query<{ id: string }>(`insert into users (username) values ($1) returning id`, [`identify-consent-test-${Date.now()}`]);
      userId = userResult.rows[0]!.id;

      // Без консента: даже с обоими id событие не пишется.
      await analytics.emitEvent({ eventName: "model_view", anonId, userId: UserId(userId), props: {} });
      expect(await eventsFor(anonId, userId)).toHaveLength(0);

      // Консент дан анонимом ДО логина — по identify-merge переносится на subject и после логина.
      await grantConsent({ anonId });
      await analytics.emitEvent({ eventName: "model_view", anonId, userId: UserId(userId), props: {} });
      expect(await eventsFor(anonId, userId)).toHaveLength(1);
    } finally {
      await pool.query(`delete from events where anon_id = $1`, [anonId]);
      await pool.query(`delete from consent_records where anon_id = $1`, [anonId]);
      if (userId) await pool.query(`delete from users where id = $1`, [userId]);
    }
  });
});

// MF-823: 4 новых значения таксономии /feed — проверяем, что events_event_name_check
// (миграция 20260710370000_feed_events_taxonomy.sql) реально принимает их, не только что
// TS-константа EVENT_NAMES их перечисляет.
describe("emitEvent — таксономия /feed (MF-823)", () => {
  it.each(["feed_post_open", "feed_scope_change", "feed_post_draft_start", "community_subscribe"] as const)("writes a row for %s once consent is granted", async (eventName) => {
    const anonId = `anon-${randomUUID()}`;
    try {
      await grantConsent({ anonId });
      await analytics.emitEvent({ eventName, anonId, userId: null, props: {} });
      const rows = await eventsFor(anonId, null);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.event_name).toBe(eventName);
    } finally {
      await pool.query(`delete from events where anon_id = $1`, [anonId]);
      await pool.query(`delete from consent_records where anon_id = $1`, [anonId]);
    }
  });
});

// MF-1096: 4 новых значения таксономии каталога /printers — проверяем, что events_event_name_check
// (миграция 20260717140000_printer_catalog_events_taxonomy.sql) реально принимает их, не только что
// TS-константа EVENT_NAMES их перечисляет.
describe("emitEvent — таксономия каталога /printers (MF-1096)", () => {
  it.each(["printer_catalog_view", "printer_facet_apply", "printer_card_view", "printer_card_click_through"] as const)(
    "writes a row for %s once consent is granted",
    async (eventName) => {
      const anonId = `anon-${randomUUID()}`;
      try {
        await grantConsent({ anonId });
        await analytics.emitEvent({ eventName, anonId, userId: null, props: {} });
        const rows = await eventsFor(anonId, null);
        expect(rows).toHaveLength(1);
        expect(rows[0]!.event_name).toBe(eventName);
      } finally {
        await pool.query(`delete from events where anon_id = $1`, [anonId]);
        await pool.query(`delete from consent_records where anon_id = $1`, [anonId]);
      }
    },
  );
});
