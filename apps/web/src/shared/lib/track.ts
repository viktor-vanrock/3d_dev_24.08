// Клиент событий активации (Фаза 3, MF-438 § «События активации в MF-41»). Пишет через
// новый POST /me/activation/events (apps/api/src/profile/activation.ts) — тонкая обёртка
// над emitEvent (apps/api/src/analytics/events.ts), тем же fail-closed consent-гейтом и
// identify-merge (anon_id проставляет сервер сам из cookie, см. ensureAnonId), что и
// остальные 6 продуктовых событий MF-609. Не блокирует UI: ошибка сети/сервера теряет
// одно событие воронки, но не должна ронять экран или замедлять клик пользователя.

import { apiFetch } from "@shared/api";

// Ровно та часть таксономии MF-41 (docs/epics/analytics.events.md), что относится к
// воронке активации — расширяет events_event_name_check той же миграцией, что и
// apps/api/src/analytics/events.ts::EVENT_NAMES.
export type ActivationEventName =
  | "first_run_start"
  | "persona_declared"
  | "printer_question_answered"
  | "printer_picker_open"
  | "printer_linked"
  | "printer_not_found_manual"
  | "soft_track_chosen"
  | "checklist_step_done"
  | "home_cta_click"
  | "aha_reached"
  | "first_run_completed"
  | "state_changed"
  | "home_view"
  | "home_hint_chip_click"
  | "home_hero_submit"
  | "nav_item_click"
  | "gallery_tile_click"
  | "profile_view"
  | "generation_outcome";

export function trackActivation(eventName: ActivationEventName, props?: Record<string, unknown>): void {
  try {
    void apiFetch(`/me/activation/events`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event_name: eventName, props: props ?? {} }),
    }).catch(() => {});
  } catch {
    // аналитика best-effort — недоступность fetch (напр. в тестовом окружении) не должна падать
  }
}
