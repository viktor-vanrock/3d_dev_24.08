import { describe, expect, it, vi } from "vitest";
import { AnalyticsRepository } from "../infrastructure/analytics.repository.ts";
import { AnalyticsService } from "./analytics.service.ts";

function serviceWithRepository(overrides: Partial<AnalyticsRepository> = {}) {
  const repository = {
    hasActiveConsent: vi.fn(() => Promise.resolve(true)),
    insertEvent: vi.fn(() => Promise.resolve()),
    ...overrides,
  } as unknown as AnalyticsRepository;
  return { repository, service: new AnalyticsService(repository) };
}

describe("AnalyticsService emitEvent", () => {
  it("does not query or insert without a subject", async () => {
    const { repository, service } = serviceWithRepository();
    await service.emitEvent({ eventName: "model_view", anonId: null, userId: null });
    expect(repository.hasActiveConsent).not.toHaveBeenCalled();
    expect(repository.insertEvent).not.toHaveBeenCalled();
  });

  it("does not insert without active consent", async () => {
    const { repository, service } = serviceWithRepository({
      hasActiveConsent: vi.fn(() => Promise.resolve(false)),
    });
    await service.emitEvent({ eventName: "model_view", anonId: "anon-1", userId: null });
    expect(repository.insertEvent).not.toHaveBeenCalled();
  });

  it("does not fail the caller when analytics storage fails", async () => {
    const { service } = serviceWithRepository({
      insertEvent: vi.fn(() => Promise.reject(new Error("analytics insert failed"))),
    });
    await expect(service.emitEvent({ eventName: "model_view", anonId: "anon-1", userId: null })).resolves.toBeUndefined();
  });
});
