import { loginPath, navigate } from "../../router.ts";
import { saveGuestIntent, type GuestIntent } from "./guestintent.ts";

// Единая точка входа: гостевые CTA ведут на /login. Намерение сохраняется,
// чтобы существующий resume-механизм выполнил действие после авторизации.
export function useGuestLogin(): (intent?: GuestIntent) => void {
  return function promptGuestLogin(intent?: GuestIntent) {
    if (intent) saveGuestIntent(intent);
    navigate(loginPath(intent?.returnTo));
  };
}
