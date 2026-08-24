import type { ReactNode } from "react";
import { StatusPill } from "@shared/ui";
import "./park.css";

const BRIDGE_INSTALL_STEPS = [
  "Откройте терминал на компьютере рядом с принтером (или подключитесь к нему по SSH)",
  "Вставьте команду ниже — она поставит и запустит наш агент",
  "Готово: как только агент свяжется с порталом, страница обновится сама",
];

// Визуал enroll-кода (managed-bridge/custom, printer.wizard.md §4) — вынесен из leveltiles.tsx
// (MF-903), чтобы морда принтера (printerface/scenes/enrollscene.tsx, printer.face.md §2.3.f)
// переиспользовала его 1:1 («тот же визуальный паттерн», не второй компонент). Шаги/команда —
// параметры: у моста (leveltiles) юзер ставит агент SSH-командой, у морды (§2.3.f) агент уже
// часть прошивки — код просто вводят на 3mf.tech/link с телефона, installCommand не нужен.
export function EnrollCodeDisplay({
  code,
  installCommand,
  steps = BRIDGE_INSTALL_STEPS,
  waitingLabel = "ждём агента…",
}: {
  code: string;
  installCommand?: string;
  steps?: string[];
  waitingLabel?: ReactNode;
}) {
  return (
    <div className="parkEnrollCode">
      <div className="parkEnrollCodeValue">{code}</div>
      <ol className="parkEnrollSteps">
        {steps.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>
      {installCommand ? <code className="parkEnrollCommand">{installCommand}</code> : null}
      <div role="status" aria-live="polite">
        <StatusPill tone="dim">{waitingLabel}</StatusPill>
      </div>
    </div>
  );
}
