import type { FlagReasonCode, ModerationSubjectType } from "./moderation.types.ts";
const REASON_WEIGHT: Readonly<Record<FlagReasonCode, number>> = { illegal: 100, harassment: 80, copyright: 60, spam: 40, abuse: 40, other: 20 };
const SUBJECT_WEIGHT: Readonly<Record<ModerationSubjectType, number>> = { post: 10, thread: 10, comment: 10, make: 5, model: 5 };
export function computePriority(input: { reasonCode: FlagReasonCode; subjectType: ModerationSubjectType; openReportCount: number; ageHours: number }): number { return REASON_WEIGHT[input.reasonCode] + Math.min(Math.max(input.openReportCount - 1, 0), 10) + Math.floor(Math.max(input.ageHours, 0) / 24) + SUBJECT_WEIGHT[input.subjectType]; }
