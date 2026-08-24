import { useState, type FormEvent } from "react";
import { AuroraBackground, Button, Card, Eyebrow, Heading, Input } from "@shared/ui";
import { updateProfile, USERNAME_RE, type SessionUser } from "./session.ts";
import "./onboarding.css";

// Экран выбора @-хендла (MF-355, Фаза 2 эпика MF-14): AuthGate рендерит это вместо
// приложения, пока `handle_confirmed === false` — при первом входе username уже
// сгенерирован автоматически (handleFromLocalPart/handleFromTelegram), здесь пользователь
// либо оставляет его как есть, либо меняет на свой. Отправка (даже без правки поля) шлёт
// PATCH /me с username → бэкенд сам проставляет handle_confirmed = true.
export function HandleOnboarding({ user }: { user: SessionUser }) {
  const [username, setUsername] = useState(user.username);
  const [displayName, setDisplayName] = useState(user.display_name ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const trimmed = username.trim().toLowerCase();
  const validFormat = USERNAME_RE.test(trimmed);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!validFormat || busy) return;
    setError(null);
    setBusy(true);
    const result = await updateProfile({ username: trimmed, display_name: displayName.trim() || null });
    setBusy(false);
    if (!result.ok) {
      if (result.error === "username_taken") setError("Этот логин уже занят — выберите другой.");
      else if (result.error === "invalid_username") setError("Логин: строчные латинские буквы, цифры, точки, 3–32 символа.");
      else setError("Не удалось сохранить. Попробуйте ещё раз.");
      return;
    }
    window.location.reload();
  }

  return (
    <main className="authOnboarding">
      <AuroraBackground />
      <Card className="authOnboardingCard">
        <header className="authOnboardingHeader">
          <Eyebrow>Добро пожаловать</Eyebrow>
          <Heading size="md">Выберите логин</Heading>
        </header>
        <p className="authOnboardingIntro">
          Логин будет виден в&nbsp;профиле и&nbsp;под вашими моделями. Мы уже подобрали свободный — оставьте
          как&nbsp;есть или смените.
        </p>

        <form onSubmit={handleSubmit} className="authOnboardingForm">
          <div className="authOnboardingField">
            <label htmlFor="handle-username">
              Логин
            </label>
            <Input
              id="handle-username"
              aria-describedby={!validFormat && username ? "handle-username-hint" : undefined}
              aria-invalid={!validFormat && username ? true : undefined}
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              placeholder="Логин"
              autoComplete="username"
              autoFocus
              maxLength={32}
            />
            {username && !validFormat ? (
              <div id="handle-username-hint" className="authOnboardingHint">
                Строчные латинские буквы, цифры, точки, 3–32 символа.
              </div>
            ) : null}
          </div>

          <div className="authOnboardingField">
            <label htmlFor="handle-display-name">
              Имя (необязательно)
            </label>
            <Input
              id="handle-display-name"
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              placeholder="Как к вам обращаться"
              autoComplete="name"
              maxLength={64}
            />
          </div>

          {error ? <div className="authOnboardingError" role="alert">{error}</div> : null}

          <Button type="submit" disabled={busy || !validFormat}>
            {busy ? "Сохраняем…" : "Продолжить"}
          </Button>
        </form>
      </Card>
    </main>
  );
}
