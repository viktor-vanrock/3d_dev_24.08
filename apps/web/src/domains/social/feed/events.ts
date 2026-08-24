import { apiFetch } from "@shared/api";

// Клиентские события ленты без продуктовой ручки-источника (MF-823 таксономия, MF-980
// подключение к UI) — тот же best-effort транспорт POST /feed/events и allowlist
// FEED_CLIENT_EVENT_NAMES (apps/api/src/analytics/events.ts), что и printers/events.ts::trackPrinterEvent.
export type FeedClientEventName = "feed_scope_change" | "feed_post_draft_start";

export function trackFeedEvent(eventName: FeedClientEventName, props: Record<string, unknown> = {}): void {
  try {
    void apiFetch(`/feed/events`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event_name: eventName, props }),
    }).catch(() => {});
  } catch {
    // Аналитика best-effort — недоступность fetch (тестовое/ограниченное окружение) не должна
    // ронять экран ленты или замедлять действие пользователя.
  }
}
