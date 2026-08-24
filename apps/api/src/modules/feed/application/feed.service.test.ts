import { describe, expect, it, vi } from "vitest";
import { FeedPostId, UserId } from "../../_kernel/brandedIds.ts";
import { FeedRepository } from "../infrastructure/feed.repository.ts";
import type { FeedAnalyticsPort } from "../public/index.ts";
import { FeedService } from "./feed.service.ts";

function serviceWithSignalDeps(consented: boolean | Error) {
  const repository = {
    recordSignal: vi.fn(() => Promise.resolve()),
  };
  const analytics: FeedAnalyticsPort = {
    emit: vi.fn(() => Promise.resolve()),
    hasActiveConsent: vi.fn(() => (consented instanceof Error ? Promise.reject(consented) : Promise.resolve(consented))),
  };
  const unused = {} as never;
  const service = new FeedService(repository as unknown as FeedRepository, unused, unused, unused, unused, unused, analytics, unused, unused, unused);
  return { analytics, repository, service };
}

describe("FeedService recordSignal ownership", () => {
  const input = {
    eventType: "remix" as const,
    postId: FeedPostId("11111111-1111-4111-8111-111111111111"),
    userId: UserId("22222222-2222-4222-8222-222222222222"),
    props: { make_id: "make-1" },
  };

  it("fails closed when analytics consent is absent", async () => {
    const { repository, service } = serviceWithSignalDeps(false);
    await service.recordSignal(input);
    expect(repository.recordSignal).not.toHaveBeenCalled();
  });

  it("writes through the Feed repository after consent", async () => {
    const { repository, service } = serviceWithSignalDeps(true);
    await service.recordSignal(input);
    expect(repository.recordSignal).toHaveBeenCalledWith(input.postId, input.userId, "remix", input.props);
  });

  it("keeps the product flow fail-open when consent lookup fails", async () => {
    const { repository, service } = serviceWithSignalDeps(new Error("analytics unavailable"));
    await expect(service.recordSignal(input)).resolves.toBeUndefined();
    expect(repository.recordSignal).not.toHaveBeenCalled();
  });

  it("keeps the product flow fail-open when the signal insert fails", async () => {
    const { repository, service } = serviceWithSignalDeps(true);
    repository.recordSignal.mockRejectedValueOnce(new Error("feed insert failed"));
    await expect(service.recordSignal(input)).resolves.toBeUndefined();
  });
});
