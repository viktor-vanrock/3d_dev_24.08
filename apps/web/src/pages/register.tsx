import { DataSelect, Button, Input } from "@shared/ui";
import { useState } from "react";
import { registerAccount, type AuthFormError } from "@domains/access";
import { navigate } from "../router.ts";
import "./login.css";
import styles from "./register.module.css";
import { ErrorMessage } from "@shared/ui/error-message/error-message.tsx";

const RequiredField = (name: string) => {
  return <>{name} <span style={{ color: 'red'}}>*</span></>;
}

export function RegisterPage() {
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [gender, setGender] = useState("");
  const [birthYear, setBirthYear] = useState("");
  const [error, setError] = useState<AuthFormError | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit(event?: React.FormEvent) {
    event?.preventDefault(); setError(null);
    if (!displayName.trim()) return setError({ message: "Укажите имя." });
    setBusy(true);
    const profile = { email, displayName, ...(gender ? { gender } : {}), ...(birthYear ? { birthYear: Number(birthYear) } : {}) };
    const result = await registerAccount(profile);
    setBusy(false);
    if (!result.ok) return setError(result.error ?? { message: "Не удалось начать регистрацию. Проверьте данные." });
    sessionStorage.setItem("portal.registration.email", email);
    sessionStorage.setItem("portal.registration.displayName", displayName);
    sessionStorage.setItem("portal.registration.gender", gender);
    sessionStorage.setItem("portal.registration.birthYear", birthYear);
    sessionStorage.setItem("portal.registration.sentAt", String(Date.now()));
    navigate("/register/verify");
  }
  return <main className={`loginPage ${styles.page}`}>
    <section className={`loginCard ${styles.card}`}>
    <form className={`emailLoginForm ${styles.form}`} onSubmit={submit}>
      <h1>Регистрация</h1>
      <label className="emailLoginLabel">{RequiredField('Email')}</label>
      <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
    <label className="emailLoginLabel">{RequiredField('Имя')}</label>
    <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} required />
    <label className="emailLoginLabel" id="gender-label">Пол</label>
    <DataSelect label="Пол" value={gender} onChange={setGender}>
      <option value="">Не указывать</option>
      <option value="female">Женский</option>
      <option value="male">Мужской</option>
    </DataSelect>
    <label className="emailLoginLabel">Год рождения</label>
    <Input type="number" value={birthYear} onChange={(e) => setBirthYear(e.target.value)} min="1900" max={new Date().getFullYear()} />
    {error && <ErrorMessage {...error} onRetry={() => void submit()} />}
      <Button type="submit" disabled={busy}>{busy ? "Отправляем…" : "Зарегистрироваться"}</Button>
      <div className="loginDescription"><a href="/login">Уже есть аккаунт? Войти</a></div>
  </form></section></main>;
}
