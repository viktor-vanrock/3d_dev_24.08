export const DEVICE_CONTROL_COMMANDS = ["pause", "resume", "cancel"] as const;
export const DEVICE_SHARE_ROLES = ["operator", "viewer", "guest"] as const;
export const FIRMWARE_CLASSES = ["klipper", "octoprint", "bambu", "prusa", "creality"] as const;
export const MAX_DEVICE_TRANSFER_SIZE_BYTES = 1024 * 1024 * 1024;
export const BEST_EFFORT_DISCLAIMER =
  "Доставка на принтер — best-effort, не гарантирована. Если принтер офлайн, недоступен по каналу или профиль нельзя резолвнуть — отправка честно завершается ошибкой, без ложного «успеха».";

export type DeviceControlCommand = (typeof DEVICE_CONTROL_COMMANDS)[number] | "start";
export type DeviceShareRole = (typeof DEVICE_SHARE_ROLES)[number];
export type FirmwareClass = (typeof FIRMWARE_CLASSES)[number];

export function isFirmwareClass(value: unknown): value is FirmwareClass {
  return typeof value === "string" && (FIRMWARE_CLASSES as readonly string[]).includes(value);
}

export function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export function sanitizeFileNameBase(name: string): string {
  const cleaned = name
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return cleaned.length > 0 ? cleaned.slice(0, 64) : "profile";
}
