export interface MasterProfile {
  readonly headline: string | null;
  readonly description: string | null;
  readonly city: string | null;
  readonly slogan: string | null;
}

export const MASTER_PROFILE_EMPTY: MasterProfile = {
  headline: null,
  description: null,
  city: null,
  slogan: null,
};

export const MASTER_PROFILE_LIMITS = {
  headline: 120,
  description: 2000,
  city: 80,
  slogan: 160,
} as const;

export function masterProfile(value: unknown): MasterProfile {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return { ...MASTER_PROFILE_EMPTY };
  const record = value as Record<string, unknown>;
  const field = (name: keyof MasterProfile): string | null => (typeof record[name] === "string" ? record[name] : null);
  return {
    headline: field("headline"),
    description: field("description"),
    city: field("city"),
    slogan: field("slogan"),
  };
}

export function sanitizeMasterField(value: unknown, maxLength: number): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim().slice(0, maxLength);
  return trimmed.length > 0 ? trimmed : null;
}
