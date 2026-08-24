import { useMemo } from "react";
import { useOverlay } from "@platform/overlay";
import { playInteractionSound, type NavDirection } from "./interaction.ts";

/*
  Мост React↔interaction.ts (MF-615): muted берём из useOverlay().notifications.muted —
  ТОТ ЖЕ стейт, что уже гасит overlay/sound.ts (MF-443) и уже висит на тумблере «Звук» в
  капсуле шапки (homeheader.tsx) с наследованием prefers-reduced-motion (overlay/provider.tsx
  initialMuted()). Один источник правды вместо второго localStorage-ключа в синхроне —
  надёжнее, чем держать два состояния мьюта consistent руками.
*/
export interface InteractionSoundApi {
  tick(): void;
  cta(): void;
  toggle(): void;
  nav(direction: NavDirection): void;
  confirm(): void;
  success(): void;
  error(): void;
  offline(): void;
}

export function useInteractionSound(): InteractionSoundApi {
  const overlay = useOverlay();
  const muted = overlay.notifications.muted;
  return useMemo<InteractionSoundApi>(
    () => ({
      tick: () => playInteractionSound("tick", muted),
      cta: () => playInteractionSound("cta", muted),
      toggle: () => playInteractionSound("toggle", muted),
      nav: (direction) => playInteractionSound("nav", muted, { direction }),
      confirm: () => playInteractionSound("confirm", muted),
      success: () => playInteractionSound("success", muted),
      error: () => playInteractionSound("error", muted),
      offline: () => playInteractionSound("offline", muted),
    }),
    [muted],
  );
}
