import { useEffect, useState } from "react";
import { startRecovery, verifyRecovery, type AuthFormError } from "@domains/access";
import { Button, Input } from "@shared/ui";
import { navigate } from "../router.ts";
import "./login.css";
import styles from "./recovery.module.css";
import { ErrorMessage } from "@shared/ui/error-message/error-message.tsx";
export function RecoveryPage() {
  const [email, setEmail] = useState(""); const [code, setCode] = useState(""); const [password, setPassword] = useState(""); const [sent, setSent] = useState(false); const [message, setMessage] = useState(""); const [error, setError] = useState<AuthFormError | null>(null);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown === 0) return;
    const timer = window.setTimeout(() => setCooldown((value) => Math.max(0, value - 1)), 1000);
    return () => window.clearTimeout(timer);
  }, [cooldown]);

  async function start(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      const result = await startRecovery(email);
      if (!result.ok) return setError(result.error ?? { message: "Не удалось отправить код." });
      setSent(true);
      setCooldown(60);
      setMessage("Если адрес зарегистрирован, письмо придёт.");
    } catch {
      setError({ message: "Не удалось отправить запрос. Проверьте соединение и попробуйте ещё раз.", retryable: true });
    }
  }

  async function resend() {
    setError(null);
    try {
      const result = await startRecovery(email);
      if (!result.ok) return setError(result.error ?? { message: "Не удалось отправить код." });
      setCooldown(60);
      setMessage("Если адрес зарегистрирован, письмо придёт.");
    } catch {
      setError({ message: "Не удалось отправить запрос. Проверьте соединение и попробуйте ещё раз.", retryable: true });
    }
  }

  async function finish(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    if (!/^\d{4}$/.test(code)) return setError({ message: "Введите 4-значный код." });
    if (password.length < 12 || password.length > 20) return setError({ message: "Пароль должен содержать от 12 до 20 символов." });
    try {
      const result = await verifyRecovery(email, code, password);
      if (!result.ok) return setError(result.error ?? { message: "Не удалось обновить пароль." });
      navigate("/login", "back");
    } catch {
      setError({ message: "Не удалось отправить запрос. Проверьте соединение и попробуйте ещё раз.", retryable: true });
    }
  }
  return <main className={`loginPage ${styles.page}`}><section className={`loginCard ${styles.card}`}><form className={`emailLoginForm ${styles.form}`} onSubmit={sent ? finish : start}><h1>Восстановление доступа</h1><label className="emailLoginLabel">Email</label><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />{sent && <><label className="emailLoginLabel">Код</label><Input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 4))} /><label className="emailLoginLabel">Новый пароль</label><Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} minLength={12} maxLength={20} /></>}<p>{message}</p>{error && <ErrorMessage {...error} />}<Button type="submit" disabled={sent && (!/^\d{4}$/.test(code) || password.length < 12 || password.length > 20)}>{sent ? "Сменить пароль" : "Восстановить доступ"}</Button>{sent && <Button type="button" variant="secondary" disabled={cooldown > 0} onClick={() => void resend()}>{cooldown > 0 ? `Отправить код повторно через ${cooldown} с` : "Отправить код повторно"}</Button>}</form></section></main>;
}
