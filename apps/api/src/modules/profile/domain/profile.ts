import { createHash } from "node:crypto";

export interface ProfileContact {
  readonly label: string;
  readonly url: string;
}

export const USERNAME_RE = /^[a-z0-9](?:[a-z0-9.]{1,30}[a-z0-9])?$/;
export const DISPLAY_NAME_MAX = 64;
export const AVATAR_URL_MAX = 512;
export const BIO_MAX = 500;
export const WEBSITE_URL_MAX = 256;
export const CONTACT_LABEL_MAX = 40;
export const CONTACT_URL_MAX = 256;
export const CONTACTS_MAX = 5;

export function isValidUsername(value: string): boolean {
  return USERNAME_RE.test(value);
}

export function sanitizeContacts(value: unknown): ProfileContact[] | null {
  if (!Array.isArray(value) || value.length > CONTACTS_MAX) return null;
  const contacts: ProfileContact[] = [];
  for (const item of value) {
    if (typeof item !== "object" || item === null) return null;
    const { label, url } = item as Record<string, unknown>;
    if (typeof label !== "string" || typeof url !== "string") return null;
    const trimmedLabel = label.trim().slice(0, CONTACT_LABEL_MAX);
    const trimmedUrl = url.trim().slice(0, CONTACT_URL_MAX);
    if (trimmedLabel === "" || trimmedUrl === "") return null;
    contacts.push({ label: trimmedLabel, url: trimmedUrl });
  }
  return contacts;
}

export const AVATAR_LAYERS = {
  color: ["mint", "coral", "amber", "sky", "lilac", "royal", "aqua", "graphite", "snow"],
  texture: ["layers", "gloss", "matte", "rough", "marble", "carbon"],
  pose: ["stand", "wave", "cheer", "think", "present", "idea"],
  outfit: ["none", "sweater", "overall", "apron", "labcoat", "techvest"],
  hat: ["none", "helmet", "cap", "crown", "cat", "fox", "beanie"],
  eyes: ["dots", "happy", "wink", "visor", "sleepy", "stars"],
  beard: ["none", "stubble", "moustache", "full", "braid"],
  arms: ["plain", "gloves", "sleeves", "robot"],
  accessory: ["none", "spatula", "wrench", "heart", "caliper", "solder"],
  back: ["none", "spool", "jetpack"],
} as const;

export type AvatarLayer = keyof typeof AVATAR_LAYERS;
export type AvatarConfig = { readonly [K in AvatarLayer]: (typeof AVATAR_LAYERS)[K][number] };
export const AVATAR_SNAPSHOT_SIDES = ["left", "right", "front"] as const;
export type AvatarSnapshotSide = (typeof AVATAR_SNAPSHOT_SIDES)[number];

export interface AvatarSnapshots {
  readonly left: string | null;
  readonly right: string | null;
  readonly front: string | null;
}

export function deterministicAvatarConfig(userId: string): AvatarConfig {
  const digest = createHash("sha256").update(userId).digest();
  const result: Partial<Record<AvatarLayer, string>> = {};
  (Object.keys(AVATAR_LAYERS) as AvatarLayer[]).forEach((key, index) => {
    const values = AVATAR_LAYERS[key] as readonly string[];
    result[key] = values[digest[index]! % values.length]!;
  });
  return result as AvatarConfig;
}

export function normalizeAvatarConfig(config: Partial<AvatarConfig> | null | undefined, userId: string): AvatarConfig {
  const fallback = deterministicAvatarConfig(userId);
  const result: Partial<Record<AvatarLayer, string>> = {};
  for (const key of Object.keys(AVATAR_LAYERS) as AvatarLayer[]) {
    const value = config?.[key];
    const values = AVATAR_LAYERS[key] as readonly string[];
    result[key] = typeof value === "string" && values.includes(value) ? value : fallback[key];
  }
  return result as AvatarConfig;
}

export function parseAvatarConfig(value: unknown): AvatarConfig | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  const result: Partial<Record<AvatarLayer, string>> = {};
  for (const key of Object.keys(AVATAR_LAYERS) as AvatarLayer[]) {
    const layer = input[key];
    const values = AVATAR_LAYERS[key] as readonly string[];
    if (typeof layer !== "string" || !values.includes(layer)) return null;
    result[key] = layer;
  }
  return result as AvatarConfig;
}

export function configsEqual(left: AvatarConfig, right: AvatarConfig): boolean {
  return (Object.keys(AVATAR_LAYERS) as AvatarLayer[]).every((key) => left[key] === right[key]);
}

export function avatarSnapshotUrl(userId: string, revision: number, side: AvatarSnapshotSide, sha256: string): string {
  return `/avatars/${userId}/snapshots/${revision}/${side}/${sha256}.png`;
}

export function avatarPhotoUrl(userId: string): string {
  return `/avatars/${userId}`;
}

export type ImageFormat = "png" | "jpeg" | "gif" | "webp";
export const IMAGE_FORMATS: Record<ImageFormat, { readonly ext: string; readonly contentType: string }> = {
  png: { ext: "png", contentType: "image/png" },
  jpeg: { ext: "jpg", contentType: "image/jpeg" },
  gif: { ext: "gif", contentType: "image/gif" },
  webp: { ext: "webp", contentType: "image/webp" },
};

export function detectImageFormat(buffer: Buffer): ImageFormat | null {
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "png";
  if (buffer.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) return "jpeg";
  if (["GIF87a", "GIF89a"].includes(buffer.subarray(0, 6).toString("ascii"))) return "gif";
  if (buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP") return "webp";
  return null;
}
