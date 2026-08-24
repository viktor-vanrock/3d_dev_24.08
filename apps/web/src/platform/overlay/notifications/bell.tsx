/*
  Колокол капсулы (docs/epics/overlay.system.md §6, MF-443): заменяет хардкод
  homeCapsuleBadge="2" в home/homeheader.tsx — бейдж теперь реальный unreadCount
  из useOverlay().notifications. Презентационная кнопка: открытие/закрытие
  попапа остаётся под управлением HomeHeader (там же эксклюзивность с аватар-меню).
*/
export function NotificationBellButton({
  unreadCount,
  active,
  onClick,
}: {
  unreadCount: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="homeCapsuleControl pressable"
      data-touch-target="48"
      aria-label="Уведомления"
      data-active={active || undefined}
      onClick={onClick}
    >
      <BellIcon />
      {unreadCount > 0 ? <span className="homeCapsuleBadge">{unreadCount > 9 ? "9+" : unreadCount}</span> : null}
    </button>
  );
}

function BellIcon() {
  return (
    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M6 9a6 6 0 1 1 12 0c0 4 1.5 5.5 1.5 5.5h-15S6 13 6 9Zm4.5 8.5a1.8 1.8 0 0 0 3 0"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
