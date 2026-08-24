import { afterEach, describe, expect, it } from "vitest";
import {
  coldCommunityFreshHours,
  coldCommunityPostThreshold,
  coldCommunityWindowDays,
  freshnessBoostWeight,
  interestWindowDays,
  recommendationBoost,
  subscriptionBoostWeight,
  tagBoostWeight,
} from "./personalization.ts";

const ENV_KEYS = [
  "FEED_RECOMMEND_SUBSCRIPTION_BOOST",
  "FEED_RECOMMEND_TAG_BOOST",
  "FEED_RECOMMEND_COLD_FRESHNESS_BOOST",
  "FEED_RECOMMEND_INTEREST_WINDOW_DAYS",
  "FEED_RECOMMEND_COLD_COMMUNITY_WINDOW_DAYS",
  "FEED_RECOMMEND_COLD_COMMUNITY_POST_THRESHOLD",
  "FEED_RECOMMEND_COLD_COMMUNITY_FRESH_HOURS",
] as const;

afterEach(() => {
  for (const key of ENV_KEYS) delete process.env[key];
});

describe("boost weight/threshold env config (numberEnv/positiveIntEnv pattern)", () => {
  it("falls back to the карточка defaults when env is unset", () => {
    expect(subscriptionBoostWeight()).toBe(0.5);
    expect(tagBoostWeight()).toBe(0.3);
    expect(freshnessBoostWeight()).toBe(0.4);
    expect(interestWindowDays()).toBe(30);
    expect(coldCommunityWindowDays()).toBe(30);
    expect(coldCommunityPostThreshold()).toBe(20);
    expect(coldCommunityFreshHours()).toBe(48);
  });

  it("reads fractional weights from env on every call (tests override without rebuilding the module)", () => {
    process.env.FEED_RECOMMEND_SUBSCRIPTION_BOOST = "1.25";
    expect(subscriptionBoostWeight()).toBe(1.25);
    process.env.FEED_RECOMMEND_SUBSCRIPTION_BOOST = "0";
    expect(subscriptionBoostWeight()).toBe(0);
  });

  it("ignores a non-numeric override and keeps the fallback", () => {
    process.env.FEED_RECOMMEND_TAG_BOOST = "not-a-number";
    expect(tagBoostWeight()).toBe(0.3);
  });

  it("clamps threshold/window env to a positive integer, same as security/rateLimit.ts::positiveIntEnv", () => {
    process.env.FEED_RECOMMEND_COLD_COMMUNITY_POST_THRESHOLD = "-5";
    expect(coldCommunityPostThreshold()).toBe(20);
    process.env.FEED_RECOMMEND_COLD_COMMUNITY_POST_THRESHOLD = "12.7";
    expect(coldCommunityPostThreshold()).toBe(12);
  });
});

describe("recommendationBoost — additive combination (MF-1860 п.1: аддитивно, не мультипликативно)", () => {
  it("is 0 when none of the three signals match", () => {
    expect(recommendationBoost({ subscribed: false, interestMatch: false, coldCommunityFresh: false })).toBe(0);
  });

  it("adds exactly the subscription weight in isolation", () => {
    expect(recommendationBoost({ subscribed: true, interestMatch: false, coldCommunityFresh: false })).toBeCloseTo(subscriptionBoostWeight(), 10);
  });

  it("adds exactly the tag/interest weight in isolation", () => {
    expect(recommendationBoost({ subscribed: false, interestMatch: true, coldCommunityFresh: false })).toBeCloseTo(tagBoostWeight(), 10);
  });

  it("adds exactly the cold-community freshness weight in isolation", () => {
    expect(recommendationBoost({ subscribed: false, interestMatch: false, coldCommunityFresh: true })).toBeCloseTo(freshnessBoostWeight(), 10);
  });

  it("sums all three when every signal matches (additivity, not multiplication)", () => {
    const boost = recommendationBoost({ subscribed: true, interestMatch: true, coldCommunityFresh: true });
    expect(boost).toBeCloseTo(subscriptionBoostWeight() + tagBoostWeight() + freshnessBoostWeight(), 10);
  });

  it("stays additive with custom env weights, not just the defaults", () => {
    process.env.FEED_RECOMMEND_SUBSCRIPTION_BOOST = "2";
    process.env.FEED_RECOMMEND_TAG_BOOST = "3";
    process.env.FEED_RECOMMEND_COLD_FRESHNESS_BOOST = "5";
    const boost = recommendationBoost({ subscribed: true, interestMatch: true, coldCommunityFresh: true });
    expect(boost).toBe(10);
  });
});
