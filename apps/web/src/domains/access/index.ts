export {
  USERNAME_RE,
  useSession,
  plagIdStartUrl,
  logout,
  EMAIL_DOMAINS,
  startEmailAuth,
  verifyEmailAuth,
  updateProfile,
  uploadAvatarPhoto,
  resolveAvatarUrl,
  type SessionUser,
  type SessionState,
  type EmailDomain,
  type ProfilePatch
} from "./session.ts";

export { AuthGate } from "./authgate.tsx";
export { isClosedDev } from "./closeddev.ts";
export { useGuestLogin } from "./guestlogin.tsx";
export { GuestIntentResumer } from "./guestresume.tsx";
export { HandleOnboarding } from "./onboarding.tsx";
export {
  saveGuestIntent,
  clearGuestIntent,
  takeGuestIntent,
  savePrinterResume,
  takePrinterResume,
  type GuestIntent
} from "./guestintent.ts";

export { LegalScreen } from "./legalscreen.tsx";
export { LEGAL_PAGES, type LegalPageContent } from "./legalcontent.ts";

export { HoneypotLink } from "./honeypotlink.tsx";
