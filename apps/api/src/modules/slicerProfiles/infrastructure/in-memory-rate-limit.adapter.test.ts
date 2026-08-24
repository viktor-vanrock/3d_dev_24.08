import { afterEach, describe, expect, it } from "vitest";
import { InMemorySlicerProfileRateLimitAdapter } from "./in-memory-rate-limit.adapter.ts";

describe("Fastify-free slicer profile rate limiter", () => {
  afterEach(() => {
    delete process.env.RATE_LIMIT_PROFILE_RECOMMENDATION_USER_PER_MIN;
    delete process.env.RATE_LIMIT_PROFILE_RECOMMENDATION_IP_PER_MIN;
    delete process.env.RATE_LIMIT_PROFILE_RECOMMENDATION_FINGERPRINT_PER_MIN;
  });

  it("preserves the three-factor per-minute limit and retry metadata", () => {
    process.env.RATE_LIMIT_PROFILE_RECOMMENDATION_USER_PER_MIN = "2";
    process.env.RATE_LIMIT_PROFILE_RECOMMENDATION_IP_PER_MIN = "100";
    process.env.RATE_LIMIT_PROFILE_RECOMMENDATION_FINGERPRINT_PER_MIN = "100";
    const limiter = new InMemorySlicerProfileRateLimitAdapter();
    const identity = {
      userId: "user-1",
      ip: "127.0.0.1",
      userAgent: "vitest",
      acceptLanguage: "ru",
      acceptEncoding: "gzip",
    };

    expect(limiter.check("profile_recommendation", identity)).toMatchObject({ limited: false, remaining: 1 });
    expect(limiter.check("profile_recommendation", identity)).toMatchObject({ limited: false, remaining: 0 });
    expect(limiter.check("profile_recommendation", identity)).toMatchObject({
      limited: true,
      remaining: 0,
      retryAfterSeconds: 60,
    });
  });
});
