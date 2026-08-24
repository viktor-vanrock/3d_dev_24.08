import type { ModelId, UserId } from "../../_kernel/brandedIds.ts";
import type { AnalyticsHealth, ConsentAction, EventName } from "../domain/analytics.ts";

export const ANALYTICS_PORT = Symbol("ANALYTICS_PORT");

export interface ConsentSubject {
  readonly anonId: string | null;
  readonly userId: UserId | null;
}

export interface EmitEventInput extends ConsentSubject {
  readonly eventName: EventName;
  readonly props?: Readonly<Record<string, unknown>>;
  readonly context?: Readonly<Record<string, unknown>>;
}

export interface AnalyticsPort {
  recordConsent(subject: ConsentSubject, action: ConsentAction, version: string): Promise<void>;
  hasActiveConsent(subject: ConsentSubject): Promise<boolean>;
  emitEvent(input: EmitEventInput): Promise<void>;
  health(): Promise<AnalyticsHealth>;
  countModelViews(modelIds: readonly ModelId[]): Promise<number>;
  recentFeedInterests(userId: UserId, windowDays: number): Promise<{ readonly modelIds: readonly ModelId[]; readonly communityIds: readonly string[] }>;
}

export type { AnalyticsHealth, ConsentAction, EventName };
