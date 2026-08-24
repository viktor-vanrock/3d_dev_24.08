import { audioPlaybackUnlocked } from "./unlock.ts";

/*
  Звук интеракшн-слоя (docs/design/sound.md, MF-601/MF-615) — WebAudio-синтез тона на КАЖДЫЙ
  жест по всему сайту (тап/переход/тумблер), в отличие от overlay/sound.ts (MF-443, звук
  СОБЫТИЙ по severity). Разные движки (§0 sound.md), общий подход — синтез без аудиофайлов,
  свой AudioContext + master GainNode, как в overlay/sound.ts. Мьют — НЕ отдельный ключ:
  вызывающий (useinteractionsound.ts) передаёт muted из overlay.notifications.muted, чтобы
  один тумблер «Звук» в капсуле шапки реально глушил оба движка одним состоянием, а не
  синхронизировал две независимые копии в localStorage.
*/
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

/*
  Палитра (§2 sound.md, ориентиры громкости −18dB/−12dB/тише-tick):
  - tick: 15–25ms, самый тихий (~−18dB) — тап любой кнопки/карточки/чипа/тайла.
  - cta: двухнотный, слегка восходящий, ~120ms, средне (~−12dB) — PrimaryButton/send.
  - toggle: механический «флип» (square, короткий даунсвип) — сегмент/тема/тайл-выбор.
  - nav: тихий pitch-sweep (тише tick), направление по fwd/back — переход раздела.
*/
export function playInteractionSound(kind: InteractionSoundKind, muted: boolean, options: InteractionSoundOptions = {}): void {
  if (muted) return;
  if (!audioPlaybackUnlocked()) return;
  const audio = getAudio();
  if (!audio) return;
  const { ctx, master } = audio;
  // Даже после жеста контекст может оставаться suspended (например, после возврата из фоновой
  // вкладки); повторный resume безопасен и не создаёт звук сам по себе.
  if (ctx.state === "suspended") void ctx.resume();

  switch (kind) {
    case "tick":
      playTone(ctx, master, { freq: 900, duration: 0.02, peakGain: 0.13, type: "sine" });
      return;
    case "cta":
      playTone(ctx, master, { freq: 480, duration: 0.055, peakGain: 0.22, type: "sine" });
      playTone(ctx, master, { freq: 640, duration: 0.06, peakGain: 0.22, type: "sine", delay: 0.05 });
      return;
    case "toggle":
      playTone(ctx, master, { freq: 500, freq2: 320, duration: 0.05, peakGain: 0.2, type: "square" });
      return;
    case "nav": {
      const forward = options.direction !== "back";
      playTone(ctx, master, {
        freq: forward ? 420 : 680,
        freq2: forward ? 680 : 420,
        duration: 0.1,
        peakGain: 0.07,
        type: "sine",
      });
      return;
    }
    case "confirm":
      // Явное подтверждение действия: чуть теплее обычного tick, но короче success.
      playTone(ctx, master, { freq: 620, duration: 0.045, peakGain: 0.16, type: "sine" });
      return;
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
