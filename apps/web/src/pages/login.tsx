import { plagIdStartUrl } from "@domains/access";
import { ThemeToggle } from "@platform/theme";
import { AuroraBackground, Button } from "@shared/ui";
import { EmailLogin } from "./emaillogin.tsx";
import { MethodIcon } from "./methodicon.tsx";
import "./login.css";

const ERROR_MESSAGES: Record<string, string> = {
  access_denied: "Доступ закрыт — портал в приватной бете. Обратитесь к оператору за приглашением.",
  missing_token: "Не удалось войти — попробуйте ещё раз.",
};

// Email — основной способ (домен-гейт Сбера), сверху. SberID/PlagID — компактные
// карточки-кнопки под разделителем «Войти через» (референс — экран входа cloud.ru).
// Порядок слева направо — SberID, PlagID (docs/epics/auth.triple.md § Метод 3, требование 2026-07-06).
export function LoginPage() {
  const error = new URLSearchParams(window.location.search).get("error");
  const errorMessage = error ? (ERROR_MESSAGES[error] ?? ERROR_MESSAGES.missing_token) : null;

  return (
    <main className="loginPage">
      <AuroraBackground />

      <div className="loginThemeToggle">
        <ThemeToggle />
      </div>

      <div className="loginContent">
        <header className="loginIntro">
          <p className="loginEyebrow">3MF · ПОРТАЛ ДЛЯ 3D-ПЕЧАТИ</p>
          <h1 className="loginTitle">Печатайте идеи — от модели до готовой детали</h1>
          <p className="loginDescription">
            Находите 3D-модели, готовьте их к печати и управляйте принтерами в одном месте.
          </p>
        </header>

        <section className="loginCard" aria-label="Вход в портал">
          <div className="loginCardGrain" aria-hidden="true" />
          {errorMessage ? <div className="loginErrorBanner" role="alert">{errorMessage}</div> : null}
          <EmailLogin />

          <div className="loginDivider">
            <div className="loginDividerLine" />
            <span>Войти через</span>
            <div className="loginDividerLine" />
          </div>

          <div className="loginMethods">
            <Button
              variant="secondary"
              disabled
              title="SberID пока недоступен — ждём Client ID от Сбер ID"
              icon={<MethodIcon provider="sberid" muted />}
            >
              SberID
            </Button>
            <Button variant="secondary" href={plagIdStartUrl()} icon={<MethodIcon provider="plagid" />}>
              PlagID
            </Button>
          </div>

        </section>
      </div>
    </main>
  );
}
