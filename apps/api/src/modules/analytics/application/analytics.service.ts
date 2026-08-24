import { Inject, Injectable } from "@nestjs/common";
import type { AnalyticsHealth, ConsentAction } from "../domain/analytics.ts";
import { AnalyticsRepository } from "../infrastructure/analytics.repository.ts";
import type { AnalyticsPort, ConsentSubject, EmitEventInput } from "../public/index.ts";
import type { ModelId } from "../../_kernel/brandedIds.ts";

@Injectable()
export class AnalyticsService implements AnalyticsPort {
  constructor(@Inject(AnalyticsRepository) private readonly repository: AnalyticsRepository) {}

  async recordConsent(subject: ConsentSubject, action: ConsentAction, version: string): Promise<void> {
    await this.repository.recordConsent(subject, action, version);
  }

  async hasActiveConsent(subject: ConsentSubject): Promise<boolean> {
    return this.repository.hasActiveConsent(subject);
  }

  async emitEvent(input: EmitEventInput): Promise<void> {
    if (input.anonId === null && input.userId === null) return;
    try {
      if (!(await this.repository.hasActiveConsent(input))) return;
      await this.repository.insertEvent(input);
    } catch {
      // Analytics is deliberately fail-open for the caller. Technical request logging remains intact.
    }
  }

  async health(): Promise<AnalyticsHealth> {
    const [funnel, activity, marketplace] = await Promise.all([this.repository.funnel(30), this.repository.activity(), this.repository.marketplace()]);
    return { funnel, activity, marketplace };
  }

  async countModelViews(modelIds: readonly ModelId[]): Promise<number> {
    return this.repository.countModelViews(modelIds);
  }

  recentFeedInterests(userId: Parameters<AnalyticsPort["recentFeedInterests"]>[0], windowDays: number) {
    return this.repository.recentFeedInterests(userId, windowDays);
  }
}
