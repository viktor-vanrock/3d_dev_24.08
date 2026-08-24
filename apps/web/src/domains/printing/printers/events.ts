import { apiFetch } from "@shared/api";

export const PRINTER_CARD_SOURCE_STORAGE_KEY = "portal.printers.card.source";

export type PrinterCatalogSource = "direct" | "search" | "internal_link";
export type PrinterCardSource = "catalog" | "search" | "calendar" | "direct";
export type PrinterClickTarget = "project" | "community" | "my_printers";

export type PrinterEventName = "printer_catalog_view" | "printer_facet_apply" | "printer_card_view" | "printer_card_click_through";

// Клиентские события каталога (MF-1096, printers.research.md §6.2) используют тот же
// best-effort-транспорт, что и события ленты: аналитика не должна ломать навигацию или фасет.
export function trackPrinterEvent(eventName: PrinterEventName, props: Record<string, unknown>): void {
  try {
    void apiFetch(`/feed/events`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event_name: eventName, props }),
    }).catch(() => {});
  } catch {
    // В тестовом/ограниченном окружении fetch может быть недоступен; экран остаётся рабочим.
  }
}

// navigate() меняет history без нового document.referrer, поэтому плитка помечает источник
// перед переходом, а карточка считывает его ровно один раз.
export function markPrinterCardSource(source: "catalog" | "calendar"): void {
  try {
    sessionStorage.setItem(PRINTER_CARD_SOURCE_STORAGE_KEY, source);
  } catch {
    // Приватный режим не должен мешать открытию карточки; fallback будет direct/referrer.
  }
}

export function catalogViewSource(): PrinterCatalogSource {
  const referrer = referrerUrl();
  if (!referrer) return "direct";
  if (referrer.origin === window.location.origin) return "internal_link";
  return isSearchReferrer(referrer) ? "search" : "direct";
}

export function printerCardViewSource(): PrinterCardSource {
  const stored = consumeCardSource();
  if (stored) return stored;

  const referrer = referrerUrl();
  if (!referrer) return "direct";
  if (referrer.origin === window.location.origin) {
    if (referrer.pathname === "/printers") return "catalog";
    if (referrer.pathname === "/printers/releases") return "calendar";
  }
  return isSearchReferrer(referrer) ? "search" : "direct";
}

function consumeCardSource(): "catalog" | "calendar" | null {
  try {
    const source = sessionStorage.getItem(PRINTER_CARD_SOURCE_STORAGE_KEY);
    sessionStorage.removeItem(PRINTER_CARD_SOURCE_STORAGE_KEY);
    return source === "catalog" || source === "calendar" ? source : null;
  } catch {
    return null;
  }
}

function referrerUrl(): URL | null {
  try {
    return document.referrer ? new URL(document.referrer) : null;
  } catch {
    return null;
  }
}

function isSearchReferrer(referrer: URL): boolean {
  const hostname = referrer.hostname.toLowerCase();
  return ["google.", "yandex.", "bing.", "duckduckgo.", "search.brave.com"].some((searchHost) => hostname === searchHost.slice(0, -1) || hostname.includes(searchHost));
}
