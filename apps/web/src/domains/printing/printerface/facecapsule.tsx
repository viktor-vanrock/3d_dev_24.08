import { useEffect, useState } from "react";
import { StatusPill, type StatusTone } from "@shared/ui";
import type { FaceState } from "./facesource.ts";

// Шапка-капсула морды (printer.face.md §2.4) — всегда закреплена, без скролла/сворачивания
// (§2.2 «фикс-шапка», отличие от header-capsule.md портала). Один источник правды для текста/
// тона аккаунт-пилюли — переиспользуется и в SettingsScene (строка соединения с релеем, §2.5).
export function accountPillInfo(state: FaceState): { tone: StatusTone; text: string } {
  if (!state.accountLinked) return { tone: "dim", text: "Аккаунт не привязан" };
  if (!state.relayOnline) return { tone: "dim", text: "Локально, портал недоступен" };
  return { tone: "ok", text: `Аккаунт: ${state.accountName}` };
}

function HomeIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M4 11.5 12 4l8 7.5M6 10v9h5v-5h2v5h5v-9"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function FaceClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 15_000);
    return () => clearInterval(timer);
  }, []);
  return <span className="faceClock">{now.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}</span>;
}

export function FaceCapsule({
  state,
  onHome,
  onAccountPress,
}: {
  state: FaceState;
  onHome: () => void;
  onAccountPress: () => void;
}) {
  const account = accountPillInfo(state);
  return (
    <div className="faceCapsule">
      <button type="button" className="faceCapsuleHome pressable" aria-label="Домой" onClick={onHome}>
        <HomeIcon />
      </button>
      <div className="faceCapsuleName">{state.printerName}</div>
      <button
        type="button"
        className="faceCapsuleAccount pressable"
        onClick={state.accountLinked ? undefined : onAccountPress}
        disabled={state.accountLinked}
      >
        <StatusPill tone={account.tone}>{account.text}</StatusPill>
      </button>
      <FaceClock />
    </div>
  );
}
