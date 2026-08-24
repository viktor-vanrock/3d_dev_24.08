// Мобильный профиль 3D-вьюера (MF-433, эпик MF-42 фаза 2): тач-устройство без hover — тот же
// сигнал, что используют тач/киоск-паттерны layout.md (`:active` вместо `:hover`). На таких
// устройствах GPU/VRAM обычно слабее десктопа, поэтому вьюер стартует с урезанным DPR и грузит
// облегчённый GLB, когда он доступен (см. modelviewer.tsx `previewMobileUrl`).

const COARSE_POINTER_QUERY = "(pointer: coarse) and (hover: none)";

export function isMobileViewerProfile(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia(COARSE_POINTER_QUERY).matches;
}
