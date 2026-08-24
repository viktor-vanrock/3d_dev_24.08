// CLOSED_DEV (MF-1032, директива оператора «закрытая разработка») — build-env флаг: пока включён,
// гость не видит НИЧЕГО кроме LoginPage ни на одном роуте (GUEST_ALLOWED_SCREENS в app.tsx игнор).
// Восстановлено после затирания коллизией (MF-1001 на server.ts). Симметрично api CLOSED_DEV.
export function isClosedDev(): boolean {
  return import.meta.env.VITE_CLOSED_DEV === "1";
}
