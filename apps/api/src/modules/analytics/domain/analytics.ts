export const CONSENT_TYPE_BEHAVIORAL_ANALYTICS = "behavioral_analytics" as const;

export const CONSENT_ACTIONS = ["granted", "revoked"] as const;
export type ConsentAction = (typeof CONSENT_ACTIONS)[number];

export const EVENT_NAMES = [
  "signup",
  "first_search",
  "model_view",
  "model_download",
  "upload_publish",
  "make_posted",
  "purchase",
  "payout_requested",
  "feed_post",
  "feed_comment",
  "feed_vote",
  "feed_post_open",
  "feed_scope_change",
  "feed_post_draft_start",
  "community_subscribe",
  "printer_card_upserted",
  "generation_start",
  "generation_download",
  "printer_catalog_view",
  "printer_facet_apply",
  "printer_card_view",
  "printer_card_click_through",
  "model_search_query",
  "first_run_start",
  "persona_declared",
  "printer_question_answered",
  "printer_picker_open",
  "printer_linked",
  "printer_not_found_manual",
  "soft_track_chosen",
  "checklist_step_done",
  "home_cta_click",
  "aha_reached",
  "first_run_completed",
  "state_changed",
  "home_view",
  "home_hint_chip_click",
  "home_hero_submit",
  "nav_item_click",
  "gallery_tile_click",
  "profile_view",
  "generation_outcome",
] as const;

export type EventName = (typeof EVENT_NAMES)[number];

export interface ProductFunnel {
  readonly window_days: number;
  readonly signups: number;
  readonly activated: number;
  readonly downloaded: number;
  readonly activation_pct: number;
  readonly download_pct: number;
}

export interface ProductActivity {
  readonly dau: number;
  readonly wau: number;
  readonly mau: number;
  readonly stickiness_pct: number;
}

export interface MarketplaceHealth {
  readonly published_models_30d: number;
  readonly published_models_30d_with_download: number;
  readonly liquidity_rate: number | null;
  readonly searches_30d: number;
  readonly searches_with_download_30d: number;
  readonly search_to_download_match_rate: number | null;
}

export interface AnalyticsHealth {
  readonly funnel: ProductFunnel;
  readonly activity: ProductActivity;
  readonly marketplace: MarketplaceHealth;
}
