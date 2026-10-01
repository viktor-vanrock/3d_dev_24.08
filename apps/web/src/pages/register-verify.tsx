import { useEffect, useState } from "react";
import { registerAccount, verifyRegistration, type AuthFormError } from "@domains/access";
import { navigate } from "../router.ts";
import { Button, Input } from "@shared/ui";
import "./login.css";
import styles from "./register-verify.module.css";
import { ErrorMessage } from "@shared/ui/error-message/error-message.tsx";

export function RegisterVerifyPage() {
  const email = sessionStorage.getItem("portal.registration.email") ?? "";
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<AuthFormError | null>(null);
  const [cooldown, setCooldown] = useState(() => {
    const sentAt = Number(sessionStorage.getItem("portal.registration.sentAt"));
    return Number.isFinite(sentAt) && sentAt > 0 ? Math.max(0, 60 - Math.floor((Date.now() - sentAt) / 1000)) : 60;
  });

  useEffect(() => {
    if (cooldown === 0) return;
    const timer = window.setTimeout(() => setCooldown((value) => Math.max(0, value - 1)), 1000);
    return () => window.clearTimeout(timer);
  }, [cooldown]);

  async function resend() {
    setError(null);
    const displayName = sessionStorage.getItem("portal.registration.displayName") ?? "";
    const gender = sessionStorage.getItem("portal.registration.gender") ?? "";
    const birthYear = sessionStorage.getItem("portal.registration.birthYear") ?? "";
    const result = await registerAccount({
      email,
      displayName,
      ...(gender ? { gender } : {}),
      ...(birthYear ? { birthYear: Number(birthYear) } : {}),
    });
    if (!result.ok) return setError(result.error ?? { message: "Не удалось отправить код." });
    sessionStorage.setItem("portal.registration.sentAt", String(Date.now()));
    setCooldown(60);
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (password.length < 12 || password.length > 20) return setError({ message: "Пароль должен содержать от 12 до 20 символов." });
    const result = await verifyRegistration(email, code, password);
    if (!result.ok) {
      if (result.error?.code === "auth.invalid_code.v1") return setError({ message: "Неверный код." });
      if (result.error?.code === "auth.code_expired.v1") return setError({ message: "Код истёк. Запросите новый код." });
      if (result.error?.code === "auth.account_blocked.v1" || result.error?.code === "auth.too_many_attempts.v1") return setError({ message: "Слишком много попыток. Повторите позже.", retryable: true });
      return setError(result.error ?? { message: "Неверный или просроченный код." });
    }
    sessionStorage.removeItem("portal.registration.email");
    sessionStorage.removeItem("portal.registration.displayName");
    sessionStorage.removeItem("portal.registration.gender");
    sessionStorage.removeItem("portal.registration.birthYear");
    sessionStorage.removeItem("portal.registration.sentAt");
    navigate("/", "back");
    window.location.reload();
  }
  return <main className={`loginPage ${styles.page}`}><section className={`loginCard ${styles.card}`}><form className={`emailLoginForm ${styles.form}`} onSubmit={submit}><h1>Подтвердите email</h1><p>Введите 4-значный код из письма.</p><Input inputMode="numeric" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 4))} /><label className="emailLoginLabel">Пароль (12–20 символов)</label><Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" minLength={12} maxLength={20} />{error && <ErrorMessage {...error} />}<Button type="submit" disabled={code.length !== 4 || password.length < 12 || password.length > 20}>Подтвердить</Button><Button type="button" variant="secondary" disabled={cooldown > 0} onClick={() => void resend()}>{cooldown > 0 ? `Отправить код повторно через ${cooldown} с` : "Отправить код повторно"}</Button></form></section></main>;
}
