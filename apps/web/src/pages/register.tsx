import { useState } from "react";
import { registerAccount, type AuthFormError } from "@domains/access";
import { navigate } from "../router.ts";
import { Button, Input } from "@shared/ui";
import "./login.css";
import styles from "./register.module.css";
import { ErrorMessage } from "@shared/ui/error-message/error-message.tsx";

export function RegisterPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [gender, setGender] = useState("");
  const [birthYear, setBirthYear] = useState("");
  const [error, setError] = useState<AuthFormError | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit(event: React.FormEvent) {
    event.preventDefault(); setError(null);
    if (password.length < 12 || password.length > 20) return setError({ message: "Пароль должен содержать от 12 до 20 символов." });
    if (password !== confirmation) return setError({ message: "Пароли не совпадают." });
    if (!displayName.trim()) return setError({ message: "Укажите имя." });
    setBusy(true);
    const result = await registerAccount({ email, password, displayName, ...(gender ? { gender } : {}), ...(birthYear ? { birthYear: Number(birthYear) } : {}) });
    setBusy(false);
    if (!result.ok) return setError(result.error ?? { message: "Не удалось начать регистрацию. Проверьте данные." });
    sessionStorage.setItem("portal.registration.email", email);
    navigate("/register/verify");
  }
  return <main className={`loginPage ${styles.page}`}><section className={`loginCard ${styles.card}`}><form className={`emailLoginForm ${styles.form}`} onSubmit={submit}>
    <h1>Регистрация</h1><label className="emailLoginLabel">Email</label><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
    <label className="emailLoginLabel">Пароль</label><Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" required />
    <small>От 12 до 20 символов.</small><label className="emailLoginLabel">Подтвердите пароль</label><Input type="password" value={confirmation} onChange={(e) => setConfirmation(e.target.value)} required />
    <label className="emailLoginLabel">Имя</label><Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} required />
    <label className="emailLoginLabel">Пол (необязательно)</label><select value={gender} onChange={(e) => setGender(e.target.value)}><option value="">Не указывать</option><option value="female">Женский</option><option value="male">Мужской</option><option value="other">Другой</option></select>
    <label className="emailLoginLabel">Год рождения (необязательно)</label><Input type="number" value={birthYear} onChange={(e) => setBirthYear(e.target.value)} min="1900" max={new Date().getFullYear()} />
    {error && <ErrorMessage {...error} onRetry={() => void submit(new Event("submit") as unknown as React.FormEvent)} />}<Button type="submit" disabled={busy}>{busy ? "Отправляем…" : "Зарегистрироваться"}</Button><a href="/login">Уже есть аккаунт? Войти</a>
  </form></section></main>;
}
