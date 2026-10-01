import { audioPlaybackUnlocked } from "./unlock.ts";

// Нажатия, переключатели, навигация и подтверждения работают без звука.
// Синтезатор используется для сигналов результата и состояния устройства.
export type InteractionSoundKind = "tick" | "cta" | "toggle" | "nav" | "confirm" | "success" | "error" | "offline";
export type NavDirection = "fwd" | "back";

export interface InteractionSoundOptions {
  // Только для kind="nav": направление pitch-sweep (motion.md §2, sound.md §3) — вниз при
  // возврате назад, вверх при переходе вперёд. По умолчанию "fwd".
  direction?: NavDirection;
}

interface ToneSpec {
  freq: number;
  freq2?: number;
  duration: number;
  peakGain: number;
  type: OscillatorType;
  delay?: number;
}

let sharedContext: AudioContext | null = null;
let masterGain: GainNode | null = null;

function getAudio(): { ctx: AudioContext; master: GainNode } | null {
  if (typeof window === "undefined") return null;
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  if (!sharedContext || !masterGain) {
    sharedContext = new Ctor();
    masterGain = sharedContext.createGain();
    masterGain.gain.value = 1;
    masterGain.connect(sharedContext.destination);
  }
  return { ctx: sharedContext, master: masterGain };
}

// Одна огибающая attack-decay (§1 sound.md: короткие тона, не щелчок и не гудок) — переиспользуем
// для всех 4 тембров, различие — freq/duration/gain/type, не форма конверта.
function playTone(ctx: AudioContext, master: GainNode, spec: ToneSpec): void {
  const start = ctx.currentTime + (spec.delay ?? 0);
  const oscillator = ctx.createOscillator();
  const gain = ctx.createGain();
  oscillator.type = spec.type;
  oscillator.frequency.setValueAtTime(spec.freq, start);
  if (spec.freq2) oscillator.frequency.exponentialRampToValueAtTime(spec.freq2, start + spec.duration);

  gain.gain.setValueAtTime(0, start);
  gain.gain.linearRampToValueAtTime(spec.peakGain, start + Math.min(0.008, spec.duration / 3));
  gain.gain.exponentialRampToValueAtTime(0.0001, start + spec.duration);

  oscillator.connect(gain);
  gain.connect(master);
  oscillator.start(start);
  oscillator.stop(start + spec.duration + 0.02);
}

export function playInteractionSound(kind: InteractionSoundKind, muted: boolean, _options: InteractionSoundOptions = {}): void {
  // Единое правило для всех экранов, прямых вызовов и отложенной навигации.
  if (kind === "tick" || kind === "cta" || kind === "toggle" || kind === "nav" || kind === "confirm") return;

  if (muted) return;
  if (!audioPlaybackUnlocked()) return;
  const audio = getAudio();
  if (!audio) return;
  const { ctx, master } = audio;
  // Даже после жеста контекст может оставаться suspended (например, после возврата из фоновой
  // вкладки); повторный resume безопасен и не создаёт звук сам по себе.
  if (ctx.state === "suspended") void ctx.resume();

  switch (kind) {
    case "success":
      // Мажорная терция — позитивный исход, без резкого «дзынь».
      playTone(ctx, master, { freq: 660, duration: 0.055, peakGain: 0.16, type: "sine" });
      playTone(ctx, master, { freq: 825, duration: 0.07, peakGain: 0.14, type: "sine", delay: 0.045 });
      return;
    case "error":
      // Мягкий нисходящий бип: ошибка действия, не тревога.
      playTone(ctx, master, { freq: 300, freq2: 220, duration: 0.11, peakGain: 0.13, type: "sine" });
      return;
    case "offline":
      // Отдельный «нет связи»: два коротких низких импульса, чтобы не путать с error.
      playTone(ctx, master, { freq: 240, duration: 0.055, peakGain: 0.11, type: "triangle" });
      playTone(ctx, master, { freq: 240, duration: 0.055, peakGain: 0.09, type: "triangle", delay: 0.075 });
      return;
  }
}
