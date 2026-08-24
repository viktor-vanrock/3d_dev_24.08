// Намерение гостя (MF-912, MF-850): что доделать сразу после логина. PlagID уходит на
// auth.plag.space и возвращается редиректом на WEB_APP_URL-корень (apps/api/src/auth/plagid.ts) —
// SPA перемонтируется с нуля; email-код тоже завершается полным reload (emaillogin.tsx). Значит
// ни один вход не переживает в памяти — единственный способ донести намерение до себя-после-логина
// это sessionStorage (тот же таб, переживает и внешний редирект, и reload).
const STORAGE_KEY = "guestIntent";
const PRINTER_RESUME_KEY = "guestPrinterResume";

// Тип GuestIntent вынесен в shared/types (микроэтап 7.6): на него ссылается
// commerce как на тип. Реэкспорт — чтобы внутренние потребители брали его отсюда.
import type { GuestIntent } from "@shared/types";
export type { GuestIntent };

export function saveGuestIntent(intent: GuestIntent): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(intent));
  } catch {
    // приватный режим/квота — намерение просто не переживёт вход, промпт логина всё равно отработал
  }
}

export function clearGuestIntent(): void {
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // приватный режим/недоступное хранилище — очищать нечего
  }
}

// Забирает и удаляет — намерение одноразовое, повторный маунт (F5) его больше не увидит.
export function takeGuestIntent(): GuestIntent | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    sessionStorage.removeItem(STORAGE_KEY);
    return JSON.parse(raw) as GuestIntent;
  } catch {
    return null;
  }
}

export function savePrinterResume(intent: Extract<GuestIntent, { kind: "printer_connect" }>): void {
  try { sessionStorage.setItem(PRINTER_RESUME_KEY, JSON.stringify(intent)); } catch { /* private mode */ }
}

export function takePrinterResume(): Extract<GuestIntent, { kind: "printer_connect" }> | null {
  try {
    const raw = sessionStorage.getItem(PRINTER_RESUME_KEY);
    if (!raw) return null;
    sessionStorage.removeItem(PRINTER_RESUME_KEY);
    return JSON.parse(raw) as Extract<GuestIntent, { kind: "printer_connect" }>;
  } catch { return null; }
}
