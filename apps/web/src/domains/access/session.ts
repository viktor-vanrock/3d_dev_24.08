import { useEffect, useState } from "react";

// В dev — Vite proxy на apps/api (см. vite.config.ts). В проде — тот же origin, api.3mf.tech
// за реверс-прокси на /api или отдельным доменом; здесь просто читаем VITE_API_URL.
import { apiFetch, API_URL } from "@shared/api";

// Типы сессии/пользователя вынесены в shared/types (микроэтап 7.6): на них
// ссылаются commerce и social, а домены друг друга не импортируют. Реэкспорт —
// чтобы внутренние потребители домена продолжали брать их из session.ts.
import type { SessionUser, SessionState, ProfilePatch } from "@shared/types";
export type { SessionUser, SessionState, ProfilePatch };
// Формат @ника (docs/epics/auth.triple.md § «username») — валидатор дублирует
// apps/api/src/profile/username.ts::USERNAME_RE 1:1, для мгновенной подсказки в форме
// до обращения к серверу; финальная проверка всё равно на бэкенде (PATCH /me).
export const USERNAME_RE = /^[a-z0-9](?:[a-z0-9.]{1,30}[a-z0-9])?$/;

export function useSession(): SessionState {
  const [state, setState] = useState<SessionState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;

    async function check() {
      try {
        const response = await apiFetch(`/auth/session`, { credentials: "include" });
        const data: { user: SessionUser } | null = response.ok ? await response.json() : null;
        if (!cancelled) setState(data?.user ? { status: "authenticated", user: data.user } : { status: "guest" });
      } catch {
        if (!cancelled) setState({ status: "guest" });
      }
    }

    void check();

    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}

export function plagIdStartUrl(): string {
  return `${API_URL}/auth/plagid/start`;
}

export async function logout(): Promise<void> {
  await apiFetch(`/auth/logout`, { method: "POST", credentials: "include" });
}

// Метод 1 — email, только @sberbank.ru/@sberdevices.ru (docs/epics/auth.triple.md § «Метод 1»).
export const EMAIL_DOMAINS = ["sberbank.ru", "sberdevices.ru"] as const;
export type EmailDomain = (typeof EMAIL_DOMAINS)[number];

async function postJson(path: string, body: unknown): Promise<{ ok: boolean; error?: string }> {
  const response = await apiFetch(`${path}`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: string };
  return { ok: response.ok && !!data.ok, error: data.error };
}

export function startEmailAuth(localPart: string, domain: EmailDomain) {
  return postJson("/auth/email/start", { localPart, domain });
}

export function verifyEmailAuth(localPart: string, domain: EmailDomain, code: string) {
  return postJson("/auth/email/verify", { localPart, domain, code });
}

// Правка профиля / подтверждение хендла (MF-355, Фаза 2; био/сайт/контакты — MF-357, Фаза 1
// эпика MF-15): PATCH /me, apps/api/src/profile/profile.ts. Ошибки — invalid_username/
// invalid_display_name/invalid_avatar_url/invalid_bio/invalid_website_url/invalid_contacts
// (400) и username_taken (409); вызывающая форма показывает их сама.
export async function updateProfile(patch: ProfilePatch): Promise<{ ok: boolean; error?: string; user?: SessionUser }> {
  const response = await apiFetch(`/me`, {
    method: "PATCH",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  const data = (await response.json().catch(() => ({}))) as { user?: SessionUser; error?: string };
  return { ok: response.ok, error: data.error, user: data.user };
}

// Загрузка фото-аватарки (MF-357): POST /me/avatar-photo, apps/api/src/profile/avatarphoto.ts.
// blob — уже кадрированный/сжатый на клиенте (см. market/accounteditor.tsx). Ошибки:
// UNSUPPORTED_IMAGE_FORMAT (415), FILE_TOO_LARGE (413), storage_not_configured (503).
export async function uploadAvatarPhoto(blob: Blob): Promise<{ ok: boolean; error?: string; user?: SessionUser }> {
  const form = new FormData();
  form.append("file", blob, "avatar.png");
  const response = await apiFetch(`/me/avatar-photo`, {
    method: "POST",
    credentials: "include",
    body: form,
  });
  const data = (await response.json().catch(() => ({}))) as { user?: SessionUser; error?: string };
  return { ok: response.ok, error: data.error, user: data.user };
}

// avatar_url бывает и внешней вставленной ссылкой (абсолютный http(s) URL, как раньше), и нашим
// собственным proxy-путём /avatars/:userId (относительный, MF-357) — API и веб на разных
// поддоменах (market/models.ts::apiAssetUrl — тот же приём для thumb_url/preview.glb),
// достраивать абсолютный адрес нужно только для второго случая.
export function resolveAvatarUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  return url.startsWith("/") ? `${API_URL}${url}` : url;
}
