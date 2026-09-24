import { useState } from "react";
import { registerAccount, type AuthFormError } from "@domains/access";
import { navigate } from "../router.ts";
import { Button, Input } from "@shared/ui";
import "./login.css";
import styles from "./register.module.css";
import { ErrorMessage } from "@shared/ui/error-message/error-message.tsx";

const RequiredField = (name: string) => {
  return <>{name} <span style={{ color: 'red'}}>*</span></>;
}

export function RegisterPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [gender, setGender] = useState("");
  const [genderOpen, setGenderOpen] = useState(false);
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
  return <main className={`loginPage ${styles.page}`}>
    <section className={`loginCard ${styles.card}`}>
    <form className={`emailLoginForm ${styles.form}`} onSubmit={submit}>
      <h1>Регистрация</h1>
      <label className="emailLoginLabel">{RequiredField('Email')}</label>
      <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
    <label className="emailLoginLabel">{RequiredField('Пароль')}</label>
    <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" required />
    <small>От 12 до 20 символов.</small>
    <label className="emailLoginLabel">{RequiredField('Подтвердите пароль')}</label>
    <Input type="password" value={confirmation} onChange={(e) => setConfirmation(e.target.value)} required />
    <label className="emailLoginLabel">{RequiredField('Имя')}</label>
    <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} required />
    <label className="emailLoginLabel" id="gender-label">Пол</label>
    <div className={styles.genderMenu}>
      <button
        type="button"
        className={styles.genderSelect}
        aria-labelledby="gender-label"
        aria-expanded={genderOpen}
        onClick={() => setGenderOpen((open) => !open)}
      >
        {gender === "female" ? "Женский" : gender === "male" ? "Мужской" : "Не указывать"}
      </button>
      {genderOpen ? <div className={styles.genderOptions} role="listbox" aria-labelledby="gender-label">
        {[{ value: "", label: "Не указывать" }, { value: "female", label: "Женский" }, { value: "male", label: "Мужской" }].map((option) => (
          <button key={option.value || "none"} type="button" role="option" aria-selected={gender === option.value} onClick={() => { setGender(option.value); setGenderOpen(false); }}>
            {option.label}
          </button>
        ))}
      </div> : null}
    </div>
    <label className="emailLoginLabel">Год рождения</label>
    <Input type="number" value={birthYear} onChange={(e) => setBirthYear(e.target.value)} min="1900" max={new Date().getFullYear()} />
    {error && <ErrorMessage {...error} onRetry={() => void submit(new Event("submit") as unknown as React.FormEvent)} />}
      <Button type="submit" disabled={busy}>{busy ? "Отправляем…" : "Зарегистрироваться"}</Button>
      <div className="loginDescription"><a href="/login">Уже есть аккаунт? Войти</a></div>
  </form></section></main>;
}
