import { useState, type CSSProperties, type FormEvent } from "react";
import { updateProfile, USERNAME_RE, type SessionUser } from "@domains/access";
import { submitConsent } from "@platform/consent";
import type { OverlayApi } from "@platform/overlay";
import { avatarEditorPath, navigate } from "../../router.ts";
import { Button, Input } from "@shared/ui";
import { AvatarBubble, useAvatar } from "@shared/avatar";

// Форма правки профиля (MF-355, Фаза 2 эпика MF-14) — открывается из капсулы шапки
// (homeheader.tsx, пункт «Профиль»), контент модалки overlay.modal(). Username/display_name/
// Имя/ник — PATCH /me. Пользовательская визуальная идентичность задаётся только
// персонажем; фото-аватарки и URL здесь намеренно отсутствуют (MF-446).
// адрес профиля/упоминания по всему приложению — на успех перезагружаем страницу, а не
// точечно обновляем локальный стейт (тот же паттерн, что logout()/EmailLogin в session.ts).
export function ProfileEditForm({
  user,
  overlay,
  onClose,
}: {
  user: SessionUser;
  overlay: OverlayApi;
  onClose: () => void;
}) {
  const [username, setUsername] = useState(user.username);
  const [displayName, setDisplayName] = useState(user.display_name ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [revoking, setRevoking] = useState(false);
  // Персонаж-маскот (MF-449): вторая, за пределами капсулы/меню, точка показа —
  // проверка переиспользуемости AvatarBubble/useAvatar на практике.
  const [avatar, , avatarSnapshots] = useAvatar(user.id);

  const trimmed = username.trim().toLowerCase();
  const validFormat = USERNAME_RE.test(trimmed);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!validFormat || busy) return;
    setError(null);
    setBusy(true);
    const result = await updateProfile({
      username: trimmed,
      display_name: displayName.trim() || null,
    });
    setBusy(false);
    if (!result.ok) {
      if (result.error === "username_taken") setError("Этот ник уже занят — выберите другой.");
      else if (result.error === "invalid_username") setError("Ник: строчные латинские буквы, цифры, точки, 3–32 символа.");
      else setError("Не удалось сохранить. Попробуйте ещё раз.");
      return;
    }
    overlay.toast({ title: "Профиль обновлён" });
    onClose();
    window.location.reload();
  }

  // Отзыв согласия на аналитику (MF-610, docs/design/consent.md §3): временное место —
  // отдельного экрана настроек/приватности в роутере ещё нет. Форма не закрывается;
  // consent.ts эмитит подписчикам, консент-баннер появится снова при следующем показе.
  async function handleRevokeConsent() {
    if (revoking) return;
    setRevoking(true);
    const ok = await submitConsent("revoked");
    setRevoking(false);
    overlay.toast(ok ? { title: "Согласие отозвано" } : { severity: "warn", title: "Не удалось отозвать согласие" });
  }

  return (
    <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 12, minWidth: 260 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <AvatarBubble config={avatar} snapshots={avatarSnapshots} size={56} facing="front" />
        <div style={{ flex: 1 }}>
          <div style={labelStyle}>Ваш персонаж</div>
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              onClose();
              navigate(avatarEditorPath());
            }}
          >
            Редактировать персонажа
          </Button>
        </div>
      </div>

      <div>
        <label style={labelStyle} htmlFor="pe-username">
          @ник
        </label>
        <Input id="pe-username" value={username} onChange={(event) => setUsername(event.target.value)} maxLength={32} />
        {username && !validFormat ? (
          <div style={hintStyle}>Строчные латинские буквы, цифры, точки, 3–32 символа.</div>
        ) : null}
      </div>

      <div>
        <label style={labelStyle} htmlFor="pe-display-name">
          Имя
        </label>
        <Input
          id="pe-display-name"
          value={displayName}
          onChange={(event) => setDisplayName(event.target.value)}
          placeholder="Как к вам обращаться"
          maxLength={64}
        />
      </div>

      {error ? <div style={errorStyle}>{error}</div> : null}

      <Button type="submit" disabled={busy || !validFormat}>
        {busy ? "Сохраняем…" : "Сохранить"}
      </Button>

      <div style={dividerStyle} />
      <Button type="button" variant="secondary" onClick={handleRevokeConsent} disabled={revoking}>
        {revoking ? "Отзываем…" : "Отозвать согласие на аналитику"}
      </Button>
    </form>
  );
}

const labelStyle: CSSProperties = {
  display: "block",
  fontSize: 12,
  fontWeight: 600,
  color: "var(--text-dim)",
  marginBottom: 6,
};

const hintStyle: CSSProperties = {
  marginTop: 6,
  fontSize: 11.5,
  color: "var(--text-dim)",
};

const errorStyle: CSSProperties = {
  padding: "8px 12px",
  borderRadius: 10,
  background: "color-mix(in srgb, var(--accent-danger) 16%, transparent)",
  border: "1px solid color-mix(in srgb, var(--accent-danger) 40%, transparent)",
  color: "var(--accent-danger)",
  fontSize: 12,
};

const dividerStyle: CSSProperties = {
  height: 1,
  background: "var(--border)",
  margin: "4px 0",
};
