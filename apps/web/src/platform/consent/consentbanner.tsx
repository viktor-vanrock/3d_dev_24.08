import { useEffect, useState, useSyncExternalStore } from "react";
import { Button } from "@shared/ui";
import { hasCurrentConsent, subscribeConsent, submitConsent } from "./consent.ts";
import "./consent.css";

// Баннер согласия (MF-610, docs/design/consent.md): смонтирован на верху дерева (app.tsx),
// вне AuthGate — виден и анониму на экране входа («первый визит»), не только залогиненным.
// Нет кнопки «Отклонить» — fail-closed на UX-уровне: без клика «Согласен» баннер остаётся
// видимым на каждом визите/навигации (реальный fail-closed — на бэке, см. consent.ts).
export function ConsentBanner() {
  const granted = useSyncExternalStore(subscribeConsent, hasCurrentConsent, () => true);
  // Локально фиксируем успешное принятие сразу после ответа API. Это не обход
  // fail-closed: при ошибке submitConsent возвращает false и баннер остаётся.
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  // Триггер CSS-transition — setTimeout, не rAF (motion.md: rAF на паузе в фоновой
  // вкладке никогда не срабатывает, элемент застревает в opacity:0), тот же паттерн,
  // что overlay/toaster.tsx.
  const [entered, setEntered] = useState(false);
  useEffect(() => {
    if (granted) return;
    const timer = setTimeout(() => setEntered(true), 10);
    return () => clearTimeout(timer);
  }, [granted]);

  if (granted || accepted) return null;

  async function handleAccept() {
    if (busy) return;
    setBusy(true);
    // Fail-closed: на ошибку баннер просто остаётся (granted не обновится, submitConsent
    // не трогает localStorage/подписчиков) — новая попытка кликом доступна сразу.
    const submitted = await submitConsent("granted");
    if (submitted) setAccepted(true);
    setBusy(false);
  }

  return (
    <div className="consentBannerHost">
      <div className="consentBanner" data-visible={entered || undefined} role="region" aria-label="Согласие на обработку данных">
        <p className="consentBannerText">
          Мы используем cookie и анализируем ваши действия на сайте, чтобы улучшать сервис. Продолжая пользоваться
          сайтом, вы соглашаетесь с обработкой поведенческих данных. <a className="consentBannerLink" href="/legal/privacy">
            Подробнее
          </a>
        </p>
        <Button icon={null} onClick={handleAccept} disabled={busy}>
          {busy ? "Секунду…" : "Согласен"}
        </Button>
      </div>
    </div>
  );
}
