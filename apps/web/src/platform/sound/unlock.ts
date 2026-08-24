// WebAudio нельзя запускать из эффекта загрузки: Chrome/Safari разрешают его только после
// пользовательского жеста. Один guard используется обоими движками, чтобы системный overlay
// и interaction-слой одинаково уважали autoplay policy.

let unlocked = false;
let installed = false;

function unlock() {
  unlocked = true;
  window.removeEventListener("pointerdown", unlock, true);
  window.removeEventListener("keydown", unlock, true);
  window.removeEventListener("touchstart", unlock, true);
}

export function installAudioUnlockListeners(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;
  window.addEventListener("pointerdown", unlock, true);
  window.addEventListener("keydown", unlock, true);
  window.addEventListener("touchstart", unlock, true);
}

export function audioPlaybackUnlocked(): boolean {
  installAudioUnlockListeners();
  return unlocked;
}

installAudioUnlockListeners();
