import { Eyebrow, StatusPill } from "@shared/ui";
import { accountPillInfo } from "../facecapsule.tsx";
import type { FaceState } from "../facesource.ts";

// Сцена (g) — настройки/статус агента (printer.face.md §2.3.g): список строк, не форма.
// «Отвязать аккаунт» — вторичная деструктивная кнопка (текст, не заливка — редкое действие, не
// соревнуется с primary сцены (a)), с подтверждением (тот же принцип, что «Поставить прошивку»
// в мастере).
export function SettingsScene({ state, onUnlinkAccount }: { state: FaceState; onUnlinkAccount: () => void }) {
  const account = accountPillInfo(state);
  return (
    <div className="faceScene faceScene--settings reveal">
      <Eyebrow>Настройки</Eyebrow>
      <div className="faceSettingsList">
        <div className="faceSettingsRow">
          <span>Принтер</span>
          <span className="faceSettingsValue">
            {state.printerName} · {state.model}
          </span>
        </div>
        <div className="faceSettingsRow">
          <span>Портал-аккаунт</span>
          <StatusPill tone={account.tone}>{account.text}</StatusPill>
        </div>
        <div className="faceSettingsRow">
          <span>Wi-Fi</span>
          <span className="faceSettingsValue">Mesh-Workshop</span>
        </div>
        <div className="faceSettingsRow">
          <span>Прошивка</span>
          <span className="faceSettingsValue">3mf-custom 1.4.0</span>
        </div>
      </div>
      {state.accountLinked ? (
        <button type="button" className="faceUnlinkButton pressable" onClick={onUnlinkAccount}>
          Отвязать аккаунт
        </button>
      ) : null}
    </div>
  );
}
