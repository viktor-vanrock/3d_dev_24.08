import type { FlagReasonCode } from "./moderation.types.ts";
const HOURS: Readonly<Record<FlagReasonCode, number>> = { illegal: 4, harassment: 12, copyright: 72, spam: 72, abuse: 72, other: 72 };
export function computeDueAt(reasonCode: FlagReasonCode, from: Date): Date { return new Date(from.getTime() + HOURS[reasonCode] * 60 * 60 * 1000); }
