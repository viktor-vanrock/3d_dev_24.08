export const PROFILE_PERSONAS = ["novice", "maker", "author", "builder", "pro"] as const;
export const PROFILE_HOME_TIERS = ["auto", "home", "farm", "business"] as const;
export const ACTIVATION_EVENT_NAMES = [
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
] as const;

export type ProfilePersona = (typeof PROFILE_PERSONAS)[number];
export type ProfileHomeTier = (typeof PROFILE_HOME_TIERS)[number];
export type ActivationEventName = (typeof ACTIVATION_EVENT_NAMES)[number];

export interface ActivationRecord {
  readonly user_id: string;
  readonly state: "first_run" | "returning";
  readonly has_printer: boolean;
  readonly first_run_completed_at: Date | null;
  readonly primary_persona: string | null;
  readonly persona_source: string | null;
  readonly home_tier: string;
  readonly sessions_seen: number;
  readonly activation_checklist: Readonly<Record<string, boolean | string>>;
  readonly home_dismissed_prompts: Readonly<Record<string, boolean | string>>;
}

export const RETURNING_AFTER_SESSIONS = 5;
