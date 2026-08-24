import { createHash } from "node:crypto";
import { Injectable } from "@nestjs/common";
import type { RateLimitDecision, RateLimitIdentity, SlicerProfileRateLimitPort, SlicerProfileRateLimitScope } from "../public/index.ts";

interface WindowConfig {
  readonly limit: number;
  readonly env: string;
}
interface Bucket {
  hits: number[];
}

const WINDOW_MS = 60_000;

const CONFIG: Record<SlicerProfileRateLimitScope, Record<"user" | "ip" | "fingerprint", WindowConfig>> = {
  profile_recommendation: {
    user: { env: "RATE_LIMIT_PROFILE_RECOMMENDATION_USER_PER_MIN", limit: 12 },
    ip: { env: "RATE_LIMIT_PROFILE_RECOMMENDATION_IP_PER_MIN", limit: 24 },
    fingerprint: { env: "RATE_LIMIT_PROFILE_RECOMMENDATION_FINGERPRINT_PER_MIN", limit: 18 },
  },
  calibration_create: {
    user: { env: "RATE_LIMIT_CALIBRATION_CREATE_USER_PER_MIN", limit: 5 },
    ip: { env: "RATE_LIMIT_CALIBRATION_CREATE_IP_PER_MIN", limit: 10 },
    fingerprint: { env: "RATE_LIMIT_CALIBRATION_CREATE_FINGERPRINT_PER_MIN", limit: 8 },
  },
};

function configuredLimit(config: WindowConfig): number {
  const parsed = Number(process.env[config.env]);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : config.limit;
}

function fingerprint(identity: RateLimitIdentity): string {
  return createHash("sha256").update(`${identity.userAgent}\n${identity.acceptLanguage}\n${identity.acceptEncoding}`).digest("hex").slice(0, 16);
}

@Injectable()
export class InMemorySlicerProfileRateLimitAdapter implements SlicerProfileRateLimitPort {
  private readonly buckets = new Map<string, Bucket>();

  check(scope: SlicerProfileRateLimitScope, identity: RateLimitIdentity): RateLimitDecision {
    const now = Date.now();
    const factors = [
      { key: `${scope}:user:${identity.userId}`, config: CONFIG[scope].user },
      { key: `${scope}:ip:${identity.ip}`, config: CONFIG[scope].ip },
      { key: `${scope}:fp:${fingerprint(identity)}`, config: CONFIG[scope].fingerprint },
    ];
    const decisions = factors.map(({ key, config }) => this.record(key, configuredLimit(config), now));
    return decisions.find(({ limited }) => limited) ?? decisions.reduce((lowest, current) => (current.remaining < lowest.remaining ? current : lowest));
  }

  reset(): void {
    this.buckets.clear();
  }

  private record(key: string, limit: number, now: number): RateLimitDecision {
    const bucket = this.buckets.get(key) ?? { hits: [] };
    bucket.hits = bucket.hits.filter((hit) => hit > now - WINDOW_MS);
    this.buckets.set(key, bucket);
    const oldest = bucket.hits[0] ?? now;
    if (bucket.hits.length >= limit) {
      return {
        limited: true,
        retryAfterSeconds: Math.max(1, Math.ceil((oldest + WINDOW_MS - now) / 1000)),
        limit,
        remaining: 0,
        reset: Math.ceil((oldest + WINDOW_MS) / 1000),
      };
    }
    bucket.hits.push(now);
    return {
      limited: false,
      retryAfterSeconds: 0,
      limit,
      remaining: limit - bucket.hits.length,
      reset: Math.ceil(((bucket.hits[0] ?? now) + WINDOW_MS) / 1000),
    };
  }
}
