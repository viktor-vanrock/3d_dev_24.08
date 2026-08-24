import { useEffect, useRef, useState } from "react";
import { Button, Eyebrow, StatusPill } from "@shared/ui";
import { EnrollCodeDisplay } from "../../park/enrollcodepanel.tsx";

const LINK_STEPS = ["Откройте 3mf.tech/link с телефона", "Введите код ниже", "Готово — экран обновится сам"];
const MOCK_CODE = "7F3K-9QRT";
const MOCK_ACCOUNT_NAME = "Иван П.";
const MOCK_CONFIRM_DELAY_MS = 4000;
// Успех — галочка дорисовывается (motion.md §4), затем сама уводит на сцену (a) с именем
// аккаунта в шапке (§2.3.f) — не требует тапа «Готово», это автоматический переход.
const SUCCESS_HOLD_MS = 1100;

type EnrollState = "idle" | "waiting" | "success";

function CheckGlyph() {
  return (
    <svg width="40" height="40" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.6" />
      <path
        className="faceEnrollCheckPath"
        d="M7 12.5l3.2 3.2L17 9"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
        pathLength={1}
      />
    </svg>
  );
}

// Сцена (f) — вход в портал-аккаунт (printer.face.md §2.3.f): точка входа в экосистему прямо с
// принтера. Тот же визуальный паттерн, что enroll-код мастера привязки (park/enrollcodepanel.tsx,
// переиспользуется 1:1), другой контекст — устройство само показывает код, инструкция ведёт на
// 3mf.tech/link с телефона (агент уже часть прошивки, install-команды нет).
export function EnrollScene({ onLinked }: { onLinked: (accountName: string) => void }) {
  const [state, setState] = useState<EnrollState>("idle");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  function startWaiting() {
    setState("waiting");
    timerRef.current = setTimeout(() => {
      setState("success");
      timerRef.current = setTimeout(() => onLinked(MOCK_ACCOUNT_NAME), SUCCESS_HOLD_MS);
    }, MOCK_CONFIRM_DELAY_MS);
  }

  if (state === "success") {
    return (
      <div className="faceScene faceScene--enroll reveal">
        <div className="faceEnrollSuccess">
          <div className="faceEnrollCheck">
            <CheckGlyph />
          </div>
          <div className="faceEnrollSuccessText">Аккаунт привязан</div>
        </div>
      </div>
    );
  }

  return (
    <div className="faceScene faceScene--enroll reveal">
      <Eyebrow>Вход в портал-аккаунт</Eyebrow>
      {state === "idle" ? (
        <Button variant="primary" onClick={startWaiting}>
          Получить код
        </Button>
      ) : (
        <EnrollCodeDisplay code={MOCK_CODE} steps={LINK_STEPS} waitingLabel={<>ждём подтверждения…</>} />
      )}
      {state === "waiting" ? <StatusPill tone="dim">Код действует 10 минут</StatusPill> : null}
    </div>
  );
}
