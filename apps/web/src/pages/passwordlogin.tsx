import { useId, useState, type CSSProperties } from "react";
import { passwordLogin } from "@domains/access";
import { Button, Input } from "@shared/ui";
import "./login.css";

export function PasswordLogin() {
  const usernameId = useId();
  const passwordId = useId();
  const errorId = useId();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    const result = await passwordLogin(username, password);
    setBusy(false);
    if (!result.ok) {
      setError("Неверный логин или пароль");
      return;
    }
    window.location.reload();
  }

  return (
    <form onSubmit={handleSubmit} className="passwordLoginForm">
      <p className="passwordLoginTitle">Вход администратора</p>
      <label className="emailLoginLabel" htmlFor={usernameId}>Логин</label>
      <Input
        id={usernameId}
        value={username}
        onChange={(event) => {
          setUsername(event.target.value);
          setError(null);
        }}
        autoComplete="username"
        autoCapitalize="none"
        spellCheck={false}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
      />
      <label className="emailLoginLabel" htmlFor={passwordId}>Пароль</label>
      <Input
        id={passwordId}
        type="password"
        value={password}
        onChange={(event) => {
          setPassword(event.target.value);
          setError(null);
        }}
        autoComplete="current-password"
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
      />
      {error ? <div id={errorId} role="alert" style={errorStyle}>{error}</div> : null}
      <Button className="emailLoginSubmit" type="submit" disabled={busy || !username.trim() || !password} loading={busy}>
        Войти
      </Button>
    </form>
  );
}

const errorStyle: CSSProperties = {
  padding: "8px 12px",
  borderRadius: 10,
  background: "color-mix(in srgb, var(--accent-danger) 16%, transparent)",
  border: "1px solid color-mix(in srgb, var(--accent-danger) 40%, transparent)",
  color: "var(--accent-danger)",
  fontSize: 12,
};
