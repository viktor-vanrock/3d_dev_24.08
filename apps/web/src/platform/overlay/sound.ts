import { audioPlaybackUnlocked } from "@platform/sound";

/*
  Звук по семантике (docs/epics/overlay.system.md §6, MF-443): WebAudio-синтез, как в
  демо — без внешних аудиофайлов. Привязан к severity события (severity.ts SEVERITY_CONFIG
  .sound), зовётся только провайдером (toast()/alert()/notify()), не экранами напрямую.
  push — отдельный тон для гостевых уведомлений (MF-28, ещё не подключён).
*/
export type SoundKind = "success" | "warn" | "critical" | "push";

interface Tone {
  freq: number;
  freq2?: number;
  duration: number;
}

const TONES: Record<SoundKind, Tone> = {
  success: { freq: 880, freq2: 1320, duration: 0.12 },
  push: { freq: 660, duration: 0.1 },
  warn: { freq: 440, duration: 0.15 },
  critical: { freq: 330, freq2: 220, duration: 0.22 },
};

let sharedContext: AudioContext | null = null;

function getContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  sharedContext ??= new Ctor();
  return sharedContext;
}

export function playSound(kind: SoundKind, muted: boolean): void {
  if (muted || !audioPlaybackUnlocked()) return;
  const ctx = getContext();
  if (!ctx) return;
  const tone = TONES[kind];
  const now = ctx.currentTime;

  const oscillator = ctx.createOscillator();
  const gain = ctx.createGain();
  oscillator.type = "sine";
  oscillator.frequency.setValueAtTime(tone.freq, now);
  if (tone.freq2) oscillator.frequency.exponentialRampToValueAtTime(tone.freq2, now + tone.duration);

  // Короткая огибающая — не щелчок и не гудок (см. демо DEMO.md §Стиль п.7).
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(0.18, now + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + tone.duration);

  oscillator.connect(gain);
  gain.connect(ctx.destination);
  oscillator.start(now);
  oscillator.stop(now + tone.duration + 0.02);
}
