// Веб-пуш клиент (MF-434, Фаза 3 эпика MF-42) поверх бэкенд-контракта Back
// (apps/api/src/push/{routes,vapid,contract}.ts): GET /push/vapid-public-key,
// POST/DELETE /push/subscriptions, GET/PUT /push/preferences.
//
// Тумблеры типов в ЛК (MF-15) — ЗАМЕТНЫЙ UI, спека Design ещё не пришла
// (см. pwa/install.ts — тот же принцип: модуль даёт то, что можно сделать без
// дизайна). Здесь — только логика: подписка/отписка/preferences и молчаливая
// реподписка на протухший endpoint (iOS роняет push-подписку за 1-2 недели
// простоя, эпик MF-42 §«Риски»). Видимый тумблер подключит Front, когда придёт
// спека — этот модуль уже готов быть его данными.
import type { components } from "src/api/generated/openapi";
import { API_URL } from "@shared/api";

export const PUSH_TYPES = ["remix", "like", "sale", "comment", "printer_status", "new_order"] as const;
export type PushType = components["schemas"]["PushPreferenceResponseDto"]["type"];

export type PushPreference = components["schemas"]["PushPreferenceResponseDto"];

// Браузер отдаёт urlsafe-base64 VAPID-ключ строкой — pushManager.subscribe() же
// хочет Uint8Array (applicationServerKey), стандартная конвертация из web.dev.
function urlBase64ToUint8Array(base64Url: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64Url.length % 4)) % 4);
  const base64 = (base64Url + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

// Браузерная фича-поддержка. На iOS Safari < 16.4 и вне home-screen-install
// PushManager отсутствует — этого достаточно, чтобы не звать subscribe() и не
// объяснять платформу отдельной UA-веткой (та уже есть в pwa/install.ts под
// свою задачу — установку, не пуш).
export function isPushSupported(): boolean {
  return typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window;
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T | null> {
  const response = await fetch(`${API_URL}${path}`, {
    credentials: "include",
    headers: init?.body ? { "Content-Type": "application/json" } : undefined,
    ...init,
  });
  if (!response.ok) return null;
  return (await response.json().catch(() => null)) as T | null;
}

// null = VAPID не сконфигурирован на этом окружении (apps/api/src/push/vapid.ts
// no-op без ключей) — вызывающий код просто не предлагает подписку, не падает.
export async function fetchVapidPublicKey(): Promise<string | null> {
  const data = await apiFetch<components["schemas"]["VapidPublicKeyResponseDto"]>("/push/vapid-public-key");
  return data?.public_key ?? null;
}

export async function fetchPushPreferences(): Promise<PushPreference[]> {
  const data = await apiFetch<components["schemas"]["PushPreferencesResponseDto"]>("/push/preferences");
  return data ? [...data.preferences] : PUSH_TYPES.map((type) => ({ type, enabled: true }));
}

export async function setPushPreference(type: PushType, enabled: boolean): Promise<boolean> {
  const data = await apiFetch<components["schemas"]["PushPreferenceResponseDto"]>("/push/preferences", {
    method: "PUT",
    body: JSON.stringify({ type, enabled }),
  });
  return data?.enabled === enabled;
}

async function postSubscription(subscription: PushSubscription): Promise<boolean> {
  const json = subscription.toJSON();
  const data = await apiFetch<components["schemas"]["PushOkResponseDto"]>("/push/subscriptions", {
    method: "POST",
    body: JSON.stringify({ endpoint: json.endpoint, keys: json.keys }),
  });
  return data?.ok === true;
}

async function deleteSubscription(endpoint: string): Promise<void> {
  await apiFetch<components["schemas"]["PushOkResponseDto"]>("/push/subscriptions", {
    method: "DELETE",
    body: JSON.stringify({ endpoint }),
  });
}

export type SubscribeResult = "subscribed" | "unsupported" | "no_vapid" | "permission_denied" | "error";

// Первая подписка — требует явного клика юзера (тумблер, когда придёт спека):
// Notification.requestPermission() браузер разрешает только из user gesture.
export async function subscribeToPush(): Promise<SubscribeResult> {
  if (!isPushSupported()) return "unsupported";
  const publicKey = await fetchVapidPublicKey();
  if (!publicKey) return "no_vapid";

  const permission = await Notification.requestPermission();
  if (permission !== "granted") return "permission_denied";

  try {
    const registration = await navigator.serviceWorker.ready;
    const existing = await registration.pushManager.getSubscription();
    const subscription = existing ?? (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    }));
    const ok = await postSubscription(subscription);
    return ok ? "subscribed" : "error";
  } catch {
    return "error";
  }
}

// Для инициализации UI-тумблера при монтировании (docs/design/push.notifications.md §2.2):
// permission можно потерять рассинхроном с реальной подпиской (юзер чистил данные сайта),
// поэтому источник истины — сама pushManager-подписка, не Notification.permission.
export async function isSubscribed(): Promise<boolean> {
  if (!isPushSupported()) return false;
  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    return subscription !== null;
  } catch {
    return false;
  }
}

export async function unsubscribeFromPush(): Promise<boolean> {
  if (!isPushSupported()) return false;
  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    if (!subscription) return true;
    const endpoint = subscription.endpoint;
    await subscription.unsubscribe();
    await deleteSubscription(endpoint);
    return true;
  } catch {
    return false;
  }
}

// Молчаливая реподписка (эпик MF-42 §«Риски»: iOS-подписки протухают за 1-2
// недели простоя). Permission уже "granted" из прошлого раза — новый
// subscribe() не спрашивает юзера снова, браузер просто выдаёт свежий
// endpoint, который мы дозаписываем на бэкенд. Ничего не делает, если юзер
// никогда не подписывался (permission "default"/"denied") — та ветка ждёт
// видимый тумблер.
export async function resubscribeIfStale(): Promise<void> {
  if (!isPushSupported() || Notification.permission !== "granted") return;
  const publicKey = await fetchVapidPublicKey();
  if (!publicKey) return;

  try {
    const registration = await navigator.serviceWorker.ready;
    const existing = await registration.pushManager.getSubscription();
    const subscription = existing ?? (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    }));
    await postSubscription(subscription);
  } catch {
    // Тихая деградация — эпик явно требует не полагаться только на этот канал
    // для критичных оповещений (дублируются e-mail/Telegram отдельной картой).
  }
}