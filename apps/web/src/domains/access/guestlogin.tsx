import { useRef, useState, type CSSProperties } from "react";
import { useOverlay } from "@platform/overlay";
import { EmailLogin } from "../../pages/emaillogin.tsx";
import { PasswordLogin } from "../../pages/passwordlogin.tsx";
import { MethodIcon } from "../../pages/methodicon.tsx";
import { Button } from "@shared/ui";
import { clearGuestIntent, saveGuestIntent, type GuestIntent } from "./guestintent.ts";
import { devLogin, plagIdStartUrl } from "./session.ts";
import { saveAuthReturnUrl } from "../../router.ts";
import { useDevMode } from "./useDevMode.ts";
import "../../pages/login.css";

// Промпт входа поверх контента (feed.md §3/§4, marketplace.full.md §5.2/5.3, model.card.v3.md §4.4,
// home.scenario.md §3.5/§6/§8, projects.page.md §11.4) — overlay.modal(), не редирект на
// /pages/login.tsx: гость остаётся на той же странице, начатое действие переживает вход через
// guestintent.ts и доигрывается сам (useResumeGuestIntent, guestresume.tsx).
export function useGuestLogin(): (intent?: GuestIntent) => void {
  const overlay = useOverlay();
  const activeModal = useRef(false);
  return function promptGuestLogin(intent?: GuestIntent) {
    if (activeModal.current) return;
    activeModal.current = true;
    if (intent) saveGuestIntent(intent);
    overlay.modal({
      title: "Войдите, чтобы продолжить",
      content: <GuestLoginPromptBody intent={intent} />,
      onClose: () => {
        activeModal.current = false;
        clearGuestIntent();
      },
    });
  };
}

function GuestLoginPromptBody({ intent }: { intent?: GuestIntent }) {
  const isDevMode = useDevMode();
  const [devError, setDevError] = useState("");

  async function handleDevLogin() {
    setDevError("");
    try {
      await devLogin();
      window.location.reload();
    } catch {
      setDevError("Dev вход недоступен");
    }
  }

  return (
    <div style={bodyStyle}>
      <EmailLogin />
      <div style={dividerRowStyle}>
        <div style={dividerLineStyle} />
        <span style={dividerLabelStyle}>или</span>
        <div style={dividerLineStyle} />
      </div>
      <PasswordLogin />
      <div style={dividerRowStyle}>
        <div style={dividerLineStyle} />
        <span style={dividerLabelStyle}>Войти через</span>
        <div style={dividerLineStyle} />
      </div>
      <Button
        variant="secondary"
        href={plagIdStartUrl()}
        icon={<MethodIcon provider="plagid" />}
        onClick={() => {
          if (intent?.returnTo) saveAuthReturnUrl(intent.returnTo);
        }}
      >
        PlagID
      </Button>
      {isDevMode ? (
        <div className="devBypassSection">
          <div className="devBypassDivider">только для разработки</div>
          <button type="button" className="devBypassButton" onClick={() => void handleDevLogin()}>
            Войти как разработчик
          </button>
          {devError ? <p className="devBypassError" role="alert">{devError}</p> : null}
        </div>
      ) : null}
    </div>
  );
}

const bodyStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 12,
  minWidth: 260,
};

const dividerRowStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
};

const dividerLineStyle: CSSProperties = {
  flex: 1,
  height: 1,
  background: "var(--border)",
};

const dividerLabelStyle: CSSProperties = {
  fontSize: 11,
  color: "var(--text-dim)",
};
