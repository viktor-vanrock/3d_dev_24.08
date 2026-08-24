import {
  useState,
  type CSSProperties,
} from "react";
// eslint-disable-next-line boundaries/element-types -- легатное междоменное ребро (микроэтап 7.6): рантайм-зависимость, не тип/utility; развязка отложена до pages/DI-этапа. См. apps/web/MIGRATION.md.
import { updateProfile } from "@domains/access";
import type { ProfilePatch } from "@shared/types";
import { AvatarBubble, useAvatar } from "@shared/avatar";
import { useOverlay } from "@platform/overlay";
import { avatarEditorPath, navigate } from "../../router.ts";
import { Button, Eyebrow, Input } from "@shared/ui";
import "./market.css";
import type { ProfileContact, UserProfile } from "./models.ts";
import "./profile.css";

// Экран редактора профиля (MF-357, Фаза 1 эпика MF-15) — секция на собственной странице
// профиля (own === true в ProfileScreen), не модалка: имя/био/сайт/контакты — PATCH /me
// (profile/profile.ts). Персонаж редактируется единым mascot-редактором из капсулы; отдельное
// фото здесь намеренно не поддерживается. Username/@ник остаётся в старой капсульной модалке
// (home/profileedit.tsx) — смена ника перезагружает страницу целиком (инвалидирует ссылки/
// упоминания по всему приложению), это отдельный, более тяжёлый флоу, не путаем с этой формой.

const CONTACTS_MAX = 5;
const BIO_MAX = 500;
export function AccountEditor({ profile, onSaved }: { profile: UserProfile; onSaved: (patch: Partial<UserProfile>) => void }) {
  const overlay = useOverlay();
  const [displayName, setDisplayName] = useState(profile.display_name ?? "");
  const [bio, setBio] = useState(profile.bio ?? "");
  const [websiteUrl, setWebsiteUrl] = useState(profile.website_url ?? "");
  const [contacts, setContacts] = useState<ProfileContact[]>(profile.contacts);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [avatar, , avatarSnapshots] = useAvatar(profile.id);

  function addContact() {
    if (contacts.length >= CONTACTS_MAX) return;
    setContacts((prev) => [...prev, { label: "", url: "" }]);
  }

  function updateContact(index: number, patch: Partial<ProfileContact>) {
    setContacts((prev) => prev.map((contact, i) => (i === index ? { ...contact, ...patch } : contact)));
  }

  function removeContact(index: number) {
    setContacts((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleSave() {
    if (busy) return;
    setError(null);
    setBusy(true);
    const cleanContacts = contacts.map((c) => ({ label: c.label.trim(), url: c.url.trim() })).filter((c) => c.label && c.url);
    const patch: ProfilePatch = {
      display_name: displayName.trim() || null,
      bio: bio.trim() || null,
      website_url: websiteUrl.trim() || null,
      contacts: cleanContacts,
    };
    const result = await updateProfile(patch);
    setBusy(false);
    if (!result.ok) {
      if (result.error === "invalid_website_url") setError("Ссылка на сайт должна начинаться с http:// или https://.");
      else if (result.error === "invalid_contacts") setError("Проверьте контакты — не больше 5, у каждого должны быть подпись и ссылка.");
      else setError("Не удалось сохранить. Попробуйте ещё раз.");
      return;
    }
    setContacts(cleanContacts);
    overlay.toast({ title: "Профиль обновлён" });
    onSaved({ display_name: patch.display_name, bio: patch.bio, website_url: patch.website_url, contacts: cleanContacts });
  }

  return (
    <div className="ideasSection">
      <Eyebrow>Редактировать профиль</Eyebrow>

      <div className="profileCharacterEditor">
        <AvatarBubble config={avatar} snapshots={avatarSnapshots} size={72} facing="front" />
        <div>
          <strong>Ваш 3D-персонаж</strong>
          <span>Его портрет используется в ленте, комментариях и проектах.</span>
          <Button type="button" variant="secondary" onClick={() => navigate(avatarEditorPath())}>
            Настроить персонажа
          </Button>
        </div>
      </div>

      <div style={{ marginBottom: 12 }}>
        <label style={fieldLabelStyle} htmlFor="ae-display-name">
          Имя
        </label>
        <Input
          id="ae-display-name"
          value={displayName}
          onChange={(event) => setDisplayName(event.target.value)}
          placeholder="Как к вам обращаться"
          maxLength={64}
        />
      </div>

      <div style={{ marginBottom: 12 }}>
        <label style={fieldLabelStyle} htmlFor="ae-bio">
          О себе
        </label>
        <textarea
          id="ae-bio"
          className="marketTextarea"
          value={bio}
          onChange={(event) => setBio(event.target.value.slice(0, BIO_MAX))}
          placeholder="Пара слов о том, что вы печатаете"
          rows={3}
        />
      </div>

      <div style={{ marginBottom: 12 }}>
        <label style={fieldLabelStyle} htmlFor="ae-website">
          Сайт
        </label>
        <Input
          id="ae-website"
          value={websiteUrl}
          onChange={(event) => setWebsiteUrl(event.target.value)}
          placeholder="https://…"
        />
      </div>

      <div style={{ marginBottom: 12 }}>
        <div style={fieldLabelStyle}>Контакты</div>
        {contacts.map((contact, index) => (
          <div key={index} style={{ display: "flex", gap: 8, marginBottom: 8 }}>
            <Input
              value={contact.label}
              onChange={(event) => updateContact(index, { label: event.target.value })}
              placeholder="Telegram"
              maxLength={40}
              style={{ flex: "0 0 120px" }}
            />
            <Input
              value={contact.url}
              onChange={(event) => updateContact(index, { url: event.target.value })}
              placeholder="https://…"
              maxLength={256}
              style={{ flex: 1 }}
            />
            <button type="button" className="modelGlassBtn pressable" onClick={() => removeContact(index)} aria-label="Удалить контакт">
              ×
            </button>
          </div>
        ))}
        {contacts.length < CONTACTS_MAX ? (
          <button type="button" className="modelGlassBtn pressable" onClick={addContact}>
            + Добавить контакт
          </button>
        ) : null}
      </div>

      {error ? <div style={errorStyle}>{error}</div> : null}

      <Button className="profileSaveButton" type="button" onClick={() => void handleSave()} disabled={busy}>
        {busy ? "Сохраняем…" : "Сохранить"}
      </Button>
    </div>
  );
}

const fieldLabelStyle: CSSProperties = {
  display: "block",
  fontSize: 12,
  fontWeight: 600,
  color: "var(--text-dim)",
  marginBottom: 6,
};

const errorStyle: CSSProperties = {
  padding: "8px 12px",
  borderRadius: 10,
  marginBottom: 12,
  background: "color-mix(in srgb, var(--accent-danger) 16%, transparent)",
  border: "1px solid color-mix(in srgb, var(--accent-danger) 40%, transparent)",
  color: "var(--accent-danger)",
  fontSize: 12,
};
