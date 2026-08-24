// Согласие на поведенческую аналитику/cookie (152-ФЗ, MF-610, docs/design/consent.md).
// Контракт — POST /consent (MF-609): { action: "granted"|"revoked", version } → 201,
// открытый путь (работает без сессии, сервер сам ставит cookie portal_anon).

import { apiFetch } from "@shared/api";

// Версия текста согласия — хардкод-константа, синхронная по смыслу с бэком (не общий
// код). Бампнуть при изменении формулировки баннера — все, включая ранее согласившихся,
// увидят баннер снова (сравнение с последней сохранённой локально версией).
export const CONSENT_VERSION = "2026-07-09.1";

const STORAGE_KEY = "portal.consent.version";

export type ConsentAction = "granted" | "revoked";

type Listener = () => void;
const listeners = new Set<Listener>();

function emitChange(): void {
  for (const listener of listeners) listener();
}

// useSyncExternalStore-совместимая подписка: баннер и профиль читают один и тот же
// источник правды (docs/design/consent.md §3 — «стейт... из того же места, что источник
// для эмиттера»), отзыв в профиле мгновенно показывает баннер снова, без ожидания навигации.
export function subscribeConsent(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function hasCurrentConsent(): boolean {
  return localStorage.getItem(STORAGE_KEY) === CONSENT_VERSION;
}

// Fail-closed: локальный стейт (и, значит, скрытие баннера) обновляется ТОЛЬКО на
// успешный ответ сервера — сетевая ошибка/4xx оставляет баннер видимым.
export async function submitConsent(action: ConsentAction): Promise<boolean> {
  let ok: boolean;
  try {
    const response = await apiFetch(`/consent`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, version: CONSENT_VERSION }),
    });
    ok = response.ok;
  } catch {
    ok = false;
  }
  if (ok) {
    if (action === "granted") localStorage.setItem(STORAGE_KEY, CONSENT_VERSION);
    else localStorage.removeItem(STORAGE_KEY);
    emitChange();
  }
  return ok;
}
