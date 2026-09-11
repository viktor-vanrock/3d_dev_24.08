import { useId, useState } from "react";
import { passwordLogin } from "@domains/access";
import { Button, Input } from "@shared/ui";
import "./login.css";

type PasswordLoginError = string | { readonly code?: string; readonly message?: string };

function loginErrorMessage(error: PasswordLoginError | undefined): string {
  const code = typeof error === "object" ? error.code : error;
  if (code === "http.client_error.v1" || code === "request.rate_limited.v1") {
    return "Слишком много попыток, подождите";
  }
  if (code === "auth.unauthorized.v1" || code === "auth.unauthenticated.v1") {
    return "Неверный логин или пароль";
  }
  return "Не удалось войти. Попробуйте ещё раз";
}

export function PasswordLogin({ onSuccess }: { onSuccess?: () => void } = {}) {
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
    try {
      const result = await passwordLogin(username, password);
      if (!result.ok) {
        setError(loginErrorMessage(result.error as PasswordLoginError | undefined));
        return;
      }
      if (onSuccess) onSuccess();
      else window.location.reload();
    } catch {
      setError("Не удалось войти. Проверьте соединение и попробуйте ещё раз");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="passwordLoginForm">
      <p className="passwordLoginTitle">Войти по логину и паролю</p>
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
      {error ? <div id={errorId} className="passwordLoginError" role="alert">{error}</div> : null}
      <Button className="emailLoginSubmit" type="submit" disabled={busy || !username.trim() || !password} loading={busy}>
        Войти
      </Button>
    </form>
  );
}
