import { useId, useState, type CSSProperties } from "react";
import { EMAIL_DOMAINS, startEmailAuth, verifyEmailAuth, type EmailDomain } from "@domains/access";
import { Button, FieldGroup, Input } from "@shared/ui";
import "./login.css";

// Метод 1 — вводим только часть до "@", домен выбираем из списка (сейчас доступны только
// корп-домены Сбера). Отправка письма пока не подключена (нет email-провайдера) — код
// приходит в лог сервера, см. apps/api/src/auth/email.ts.
// Кнопка/поля — из библиотеки apps/web/src/ui/ui.tsx (эпик MF-40/MF-426): бывший локальный
// PrimaryButton и инлайн-стили полей удалены, 0 дублей.
export function EmailLogin() {
  const emailId = useId();
  const codeId = useId();
  const statusId = useId();
  const errorId = useId();
  const [step, setStep] = useState<"email" | "code">("email");
  const [localPart, setLocalPart] = useState("");
  const [domain, setDomain] = useState<EmailDomain>(EMAIL_DOMAINS[0]);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleStart(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    const result = await startEmailAuth(localPart, domain);
    setBusy(false);
    if (!result.ok) return setError(result.error ?? "Не удалось отправить код");
    setStep("code");
  }

  async function handleVerify(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    const result = await verifyEmailAuth(localPart, domain, code);
    setBusy(false);
    if (!result.ok) return setError(result.error ?? "Неверный код");
    window.location.reload();
  }

  if (step === "code") {
    const describedBy = error ? `${statusId} ${errorId}` : statusId;
    return (
      <form onSubmit={handleVerify} className="emailLoginForm">
        <label className="emailLoginLabel" htmlFor={codeId}>Код из письма</label>
        <div id={statusId} className="emailLoginStatus">
          Код отправлен на {localPart}@{domain}
        </div>
        <Input
          id={codeId}
          value={code}
          onChange={(event) => {
            setCode(event.target.value.replace(/\D/g, "").slice(0, 6));
            setError(null);
          }}
          placeholder="6-значный код"
          inputMode="numeric"
          autoComplete="one-time-code"
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
        />
        {error ? <div id={errorId} role="alert" style={errorStyle}>{error}</div> : null}
        <Button className="emailLoginSubmit" type="submit" disabled={busy || code.length !== 6} loading={busy}>
          Войти
        </Button>
        <Button variant="ghost" icon={null} onClick={() => {
          setError(null);
          setStep("email");
        }}>
          Изменить адрес
        </Button>
      </form>
    );
  }

  return (
    <form onSubmit={handleStart} className="emailLoginForm">
      <label className="emailLoginLabel" htmlFor={emailId}>Рабочая почта</label>
      <FieldGroup className="emailLoginField">
        <input
          id={emailId}
          value={localPart}
          onChange={(event) => {
            setLocalPart(event.target.value);
            setError(null);
          }}
          placeholder="ivan.petrov"
          inputMode="email"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
        />
        <select
          value={domain}
          onChange={(event) => {
            setDomain(event.target.value as EmailDomain);
            setError(null);
          }}
          aria-label="Домен почты"
        >
          {EMAIL_DOMAINS.map((option) => (
            <option key={option} value={option}>
              @{option}
            </option>
          ))}
        </select>
      </FieldGroup>
      {error ? <div id={errorId} role="alert" style={errorStyle}>{error}</div> : null}
      <Button className="emailLoginSubmit" type="submit" disabled={busy || !localPart.trim()} loading={busy}>
        Получить код
      </Button>
    </form>
  );
}

// Семантический коралл (docs/design/palette-typography.md — деструктив/ошибка), не голый текст —
// приглушённая плашка, консистентно с остальными статусами в референсе.
const errorStyle: CSSProperties = {
  padding: "8px 12px",
  borderRadius: 10,
  background: "color-mix(in srgb, var(--accent-danger) 16%, transparent)",
  border: "1px solid color-mix(in srgb, var(--accent-danger) 40%, transparent)",
  color: "var(--accent-danger)",
  fontSize: 12,
};
