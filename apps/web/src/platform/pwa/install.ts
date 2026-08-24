import { useEffect, useState } from "react";

// Логика установки «на домашний экран» (MF-432, эпик MF-42 §2): перехват события и
// определение платформы/уже-установленного состояния. Визуальный слой живёт отдельно в
// installbanner.tsx (MF-936), чтобы этот хук оставался единственным источником PWA-состояния.

// beforeinstallprompt — не в lib.dom.d.ts (не во всех браузерах реализовано одинаково).
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}

function isStandaloneNow(): boolean {
  // iOS Safari не поддерживает display-mode media query для PWA-режима до недавних версий
  // и исторически даёт navigator.standalone — оставляем оба пути.
  return (
    window.matchMedia?.("(display-mode: standalone)").matches === true ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

// iOS Safari не эмитит beforeinstallprompt и не даёт программной установки — только
// инструкция «Поделиться → На экран Домой» (эпик MF-42 §2). Детект по UA — единственный
// практический способ различить ветку показа; iPadOS 13+ маскируется под Mac (проверяем
// тачпоинты, тот же приём что и везде в вебе для этого случая).
function isIosSafariInstallable(): boolean {
  const ua = navigator.userAgent;
  const isIos = /iPhone|iPad|iPod/.test(ua) || (ua.includes("Macintosh") && navigator.maxTouchPoints > 1);
  const isSafari = /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS/.test(ua);
  return isIos && isSafari;
}

export interface PwaInstallState {
  // true только на платформах с programmatic-установкой (Android Chrome/Edge) после
  // того, как браузер реально предложил событие — до этого показывать баннер нечего.
  canInstall: boolean;
  // true на iOS Safari, не установленном на домашний экран — ветка «инструкция-шторка».
  showIosInstructions: boolean;
  isStandalone: boolean;
  promptInstall: () => Promise<"accepted" | "dismissed" | "unavailable">;
}

export function usePwaInstall(): PwaInstallState {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [standalone, setStandalone] = useState(isStandaloneNow);

  useEffect(() => {
    function onBeforeInstallPrompt(event: Event) {
      event.preventDefault();
      setDeferred(event as BeforeInstallPromptEvent);
    }
    function onAppInstalled() {
      setDeferred(null);
      setStandalone(true);
    }
    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    window.addEventListener("appinstalled", onAppInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
      window.removeEventListener("appinstalled", onAppInstalled);
    };
  }, []);

  async function promptInstall(): Promise<"accepted" | "dismissed" | "unavailable"> {
    if (!deferred) return "unavailable";
    await deferred.prompt();
    const { outcome } = await deferred.userChoice;
    setDeferred(null);
    return outcome;
  }

  return {
    canInstall: deferred !== null && !standalone,
    showIosInstructions: !standalone && isIosSafariInstallable(),
    isStandalone: standalone,
    promptInstall,
  };
}
