import { useState } from "react";
import { verifyRegistration, type AuthFormError } from "@domains/access";
import { navigate } from "../router.ts";
import { Button, Input } from "@shared/ui";
import "./login.css";
import styles from "./register-verify.module.css";
import { ErrorMessage } from "@shared/ui/error-message/error-message.tsx";

export function RegisterVerifyPage() {
  const [code, setCode] = useState(""); const [error, setError] = useState<AuthFormError | null>(null); const email = sessionStorage.getItem("portal.registration.email") ?? "";
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const result = await verifyRegistration(email, code);
    if (!result.ok) {
      if (result.error?.code === "auth.unauthorized.v1" || result.error?.code === "auth.unauthenticated.v1") return setError({ message: "Неверный код." });
      return setError(result.error ?? { message: "Неверный или просроченный код." });
    }
    sessionStorage.removeItem("portal.registration.email");
    navigate("/", "back");
    window.location.reload();
  }
  return <main className={`loginPage ${styles.page}`}><section className={`loginCard ${styles.card}`}><form className={`emailLoginForm ${styles.form}`} onSubmit={submit}><h1>Подтвердите email</h1><p>Введите 4-значный код из письма.</p><Input inputMode="numeric" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 4))} />{error && <ErrorMessage {...error} />}<Button type="submit" disabled={code.length !== 4}>Подтвердить</Button></form></section></main>;
}
