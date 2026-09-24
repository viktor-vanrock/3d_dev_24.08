import { useState } from "react";
import { startRecovery, verifyRecovery, type AuthFormError } from "@domains/access";
import { Button, Input } from "@shared/ui";
import "./login.css";
import styles from "./recovery.module.css";
import { ErrorMessage } from "@shared/ui/error-message/error-message.tsx";
export function RecoveryPage() {
  const [email, setEmail] = useState(""); const [code, setCode] = useState(""); const [password, setPassword] = useState(""); const [sent, setSent] = useState(false); const [message, setMessage] = useState(""); const [error, setError] = useState<AuthFormError | null>(null);
  async function start(event: React.FormEvent) { event.preventDefault(); const result = await startRecovery(email); if (!result.ok) return setError(result.error ?? { message: "Не удалось отправить код." }); setSent(true); setMessage("Если адрес зарегистрирован, письмо придёт."); }
  async function finish(event: React.FormEvent) { event.preventDefault(); const result = await verifyRecovery(email, code, password); if (!result.ok) return setError(result.error ?? { message: "Не удалось обновить пароль." }); setMessage("Пароль обновлён. Войдите с новым паролем."); }
  return <main className={`loginPage ${styles.page}`}><section className={`loginCard ${styles.card}`}><form className={`emailLoginForm ${styles.form}`} onSubmit={sent ? finish : start}><h1>Восстановление доступа</h1><label className="emailLoginLabel">Email</label><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />{sent && <><label className="emailLoginLabel">Код</label><Input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 4))} /><label className="emailLoginLabel">Новый пароль</label><Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} /></>}<p>{message}</p>{error && <ErrorMessage {...error} />}<Button type="submit">{sent ? "Сменить пароль" : "Восстановить доступ"}</Button></form></section></main>;
}
