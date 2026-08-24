import { useEffect, useState, useSyncExternalStore } from "react";
import { hasCurrentConsent, subscribeConsent } from "@platform/consent";
import { useOverlay } from "@platform/overlay";
import { useInteractionSound } from "@platform/sound";
import { Button, IconButton, PrinterIcon } from "@shared/ui";
import { usePwaInstall } from "./install.ts";
import "./installbanner.css";

const DISMISSED_KEY = "portal.pwa.installDismissedAt";
const COOLDOWN_MS = 14 * 86_400_000;

function isInInstallCooldown(): boolean {
  const dismissedAt = Date.parse(localStorage.getItem(DISMISSED_KEY) ?? "");
  return Number.isFinite(dismissedAt) && Date.now() - dismissedAt < COOLDOWN_MS;
}

function rememberDismissal(): void {
  localStorage.setItem(DISMISSED_KEY, new Date().toISOString());
}

function ShareIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 15V3m0 0L8 7m4-4 4 4M6 10H5a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7a2 2 0 0 0-2-2h-1" />
    </svg>
  );
}

function HomeScreenIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="4" y="4" width="16" height="16" rx="2" />
      <path d="M12 8v8M8 12h8" />
    </svg>
  );
}

function AddIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

function IosInstallSteps() {
  return (
    <ol className="installSteps">
      <li>
        <span className="installStepIcon"><ShareIcon /></span>
        <span>Нажмите иконку «Поделиться» (квадрат со стрелкой вверх) внизу экрана Safari.</span>
      </li>
      <li>
        <span className="installStepIcon"><HomeScreenIcon /></span>
        <span>Прокрутите список вниз и выберите «На экран Домой».</span>
      </li>
      <li>
        <span className="installStepIcon"><AddIcon /></span>
        <span>Нажмите «Добавить» в правом верхнем углу.</span>
      </li>
    </ol>
  );
}

export function InstallBanner() {
  const consentGranted = useSyncExternalStore(subscribeConsent, hasCurrentConsent, () => true);
  const { canInstall, showIosInstructions, isStandalone, promptInstall } = usePwaInstall();
  const overlay = useOverlay();
  const sound = useInteractionSound();
  const [cooldown] = useState(isInInstallCooldown);
  const [hidden, setHidden] = useState(false);
  const [entered, setEntered] = useState(false);

  const isIos = !canInstall && showIosInstructions;
  const visible = consentGranted && !isStandalone && !cooldown && !hidden && (canInstall || isIos);

  useEffect(() => {
    if (!visible) {
      setEntered(false);
      return;
    }
    const timer = setTimeout(() => setEntered(true), 10);
    return () => clearTimeout(timer);
  }, [visible]);

  if (!visible) return null;

  function dismiss(): void {
    sound.tick();
    rememberDismissal();
    setHidden(true);
  }

  async function installAndroid(): Promise<void> {
    sound.cta();
    const outcome = await promptInstall();
    if (outcome === "dismissed") rememberDismissal();
    setHidden(true);
  }

  function showIosSteps(): void {
    sound.cta();
    rememberDismissal();
    setHidden(true);
    overlay.sheet({
      title: "Установка на экран «Домой»",
      content: <IosInstallSteps />,
    });
  }

  return (
    <div className="installBannerHost">
      <section
        className="installBanner"
        data-visible={entered || undefined}
        role="region"
        aria-label="Установка приложения"
      >
        <div className="installBannerIntro">
          <span className="installBannerIcon"><PrinterIcon size={24} /></span>
          <div className="installBannerCopy">
            <strong>Установите 3mf.tech</strong>
            <span>{isIos ? "Добавьте на экран «Домой» — как обычное приложение." : "Быстрый доступ с домашнего экрана и офлайн-режим."}</span>
          </div>
        </div>
        <Button className="installBannerCta" icon={null} onClick={isIos ? showIosSteps : installAndroid}>
          {isIos ? "Как установить" : "Установить"}
        </Button>
        <span className="installBannerClose">
          <IconButton label="Закрыть" onClick={dismiss}>✕</IconButton>
        </span>
      </section>
    </div>
  );
}
