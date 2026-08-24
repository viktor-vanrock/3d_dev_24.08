export const PUSH_TYPES = ["remix", "like", "sale", "comment", "printer_status", "new_order"] as const;

export type PushType = (typeof PUSH_TYPES)[number];

export function isPushType(value: unknown): value is PushType {
  return typeof value === "string" && (PUSH_TYPES as readonly string[]).includes(value);
}

export interface PushPayload {
  readonly title: string;
  readonly body: string;
  readonly deepLink: string;
}

export interface PushPreference {
  readonly type: PushType;
  readonly enabled: boolean;
}
