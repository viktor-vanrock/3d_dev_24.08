import { Inject, Injectable } from "@nestjs/common";
import type { Pool } from "pg";
import { DATABASE_POOL } from "../../../nest/database/database.constants.ts";
import type { ProductActivity, ProductFunnel, MarketplaceHealth, ConsentAction } from "../domain/analytics.ts";
import { CONSENT_TYPE_BEHAVIORAL_ANALYTICS } from "../domain/analytics.ts";
import type { ConsentSubject, EmitEventInput } from "../public/index.ts";
import { ModelId, type ModelId as ModelIdType, type UserId } from "../../_kernel/brandedIds.ts";

function pct(part: number, total: number): number {
  if (total === 0) return 0;
  return Math.round((part / total) * 1000) / 10;
}

@Injectable()
export class AnalyticsRepository {
  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {}

  async recordConsent(subject: ConsentSubject, action: ConsentAction, version: string): Promise<void> {
    await this.pool.query(`insert into consent_records (anon_id, user_id, consent_type, version, action) values ($1, $2, $3, $4, $5)`, [
      subject.anonId,
      subject.userId,
      CONSENT_TYPE_BEHAVIORAL_ANALYTICS,
      version,
      action,
    ]);
  }

  async hasActiveConsent(subject: ConsentSubject): Promise<boolean> {
    if (subject.anonId === null && subject.userId === null) return false;
    const result = await this.pool.query<{ action: ConsentAction }>(
      `select action from consent_records
       where consent_type = $1
         and ((anon_id is not null and anon_id = $2) or (user_id is not null and user_id = $3))
       order by created_at desc
       limit 1`,
      [CONSENT_TYPE_BEHAVIORAL_ANALYTICS, subject.anonId, subject.userId],
    );
    return result.rows[0]?.action === "granted";
  }

  async insertEvent(input: EmitEventInput): Promise<void> {
    await this.pool.query(`insert into events (event_name, anon_id, user_id, props, context) values ($1, $2, $3, $4, $5)`, [
      input.eventName,
      input.anonId,
      input.userId,
      JSON.stringify(input.props ?? {}),
      JSON.stringify(input.context ?? {}),
    ]);
  }

  async countModelViews(modelIds: readonly ModelId[]): Promise<number> {
    if (modelIds.length === 0) return 0;
    const result = await this.pool.query<{ count: string }>(
      `select count(*) as count from events
       where event_name = 'model_view' and props->>'model_id' = any($1::text[])`,
      [modelIds],
    );
    return Number(result.rows[0]!.count);
  }

  async recentFeedInterests(userId: UserId, windowDays: number): Promise<{ readonly modelIds: readonly ModelIdType[]; readonly communityIds: readonly string[] }> {
    const rows = (
      await this.pool.query<{ model_id: string | null; community_id: string | null }>(
        `select distinct
         case when event_name in ('model_view','model_download') then props->>'model_id' else null end model_id,
         case when event_name in ('feed_post_open','feed_vote','feed_comment') then props->>'community_id' else null end community_id
       from events
       where user_id=$1 and created_at>=now()-($2::int*interval '1 day')
         and event_name in ('model_view','model_download','feed_post_open','feed_vote','feed_comment')`,
        [userId, windowDays],
      )
    ).rows;
    return {
      modelIds: [...new Set(rows.flatMap((row) => (row.model_id === null ? [] : [ModelId(row.model_id)])))],
      communityIds: [...new Set(rows.flatMap((row) => (row.community_id === null ? [] : [row.community_id])))],
    };
  }

  async funnel(windowDays = 30): Promise<ProductFunnel> {
    const result = await this.pool.query<{ signups: string; activated: string; downloaded: string }>(
      `with cohort as (
         select user_id, min(created_at) as signup_at
         from events
         where event_name = 'signup' and user_id is not null
           and created_at >= now() - ($1::int * interval '1 day')
         group by user_id
       ),
       activated as (
         select distinct c.user_id
         from cohort c
         join events e on e.user_id = c.user_id and e.event_name = 'aha_reached' and e.created_at >= c.signup_at
       ),
       downloaded as (
         select distinct c.user_id
         from cohort c
         join events e on e.user_id = c.user_id and e.event_name = 'model_download' and e.created_at >= c.signup_at
       )
       select
         (select count(*) from cohort) as signups,
         (select count(*) from activated) as activated,
         (select count(*) from downloaded) as downloaded`,
      [windowDays],
    );
    const row = result.rows[0]!;
    const signups = Number(row.signups);
    const activated = Number(row.activated);
    const downloaded = Number(row.downloaded);
    return {
      window_days: windowDays,
      signups,
      activated,
      downloaded,
      activation_pct: pct(activated, signups),
      download_pct: pct(downloaded, signups),
    };
  }

  async activity(): Promise<ProductActivity> {
    const result = await this.pool.query<{ dau: string; wau: string; mau: string }>(
      `select
         count(distinct coalesce(user_id::text, anon_id)) filter (where created_at >= now() - interval '1 day') as dau,
         count(distinct coalesce(user_id::text, anon_id)) filter (where created_at >= now() - interval '7 days') as wau,
         count(distinct coalesce(user_id::text, anon_id)) filter (where created_at >= now() - interval '30 days') as mau
       from events
       where created_at >= now() - interval '30 days'`,
    );
    const row = result.rows[0]!;
    const dau = Number(row.dau);
    const mau = Number(row.mau);
    return { dau, wau: Number(row.wau), mau, stickiness_pct: pct(dau, mau) };
  }

  async marketplace(): Promise<MarketplaceHealth> {
    const result = await this.pool.query<{
      published_models_30d: string;
      published_models_30d_with_download: string;
      liquidity_rate: string | null;
      searches_30d: string;
      searches_with_download_30d: string;
      search_to_download_match_rate: string | null;
    }>(
      `select
         l.published_models_30d,
         l.published_models_30d_with_download,
         l.liquidity_rate,
         m.searches_30d,
         m.searches_with_download_30d,
         m.search_to_download_match_rate
       from marketplace_liquidity_30d l, marketplace_search_match_rate_30d m`,
    );
    const row = result.rows[0]!;
    return {
      published_models_30d: Number(row.published_models_30d),
      published_models_30d_with_download: Number(row.published_models_30d_with_download),
      liquidity_rate: row.liquidity_rate === null ? null : Number(row.liquidity_rate),
      searches_30d: Number(row.searches_30d),
      searches_with_download_30d: Number(row.searches_with_download_30d),
      search_to_download_match_rate: row.search_to_download_match_rate === null ? null : Number(row.search_to_download_match_rate),
    };
  }
}
