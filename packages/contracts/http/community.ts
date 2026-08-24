/** Межсервисный HTTP-контракт защиты community: только формы и значения. */

export const COMMUNITY_ANTIABUSE_VERSION = "community-antiabuse.v1" as const;

export const TL0_LIMITS = {
  maxLinksPerContribution: 1,
  maxAttachmentsPerContribution: 0,
  maxThreadsPerRollingDay: 3,
  maxPostsPerRollingDay: 10,
  editWindowSeconds: 15 * 60,
  requiredTrustLevelForDirectMessages: 1,
} as const;

export const COMMUNITY_RATE_LIMITS = {
  create: { accountPerMinute: 3, ipPerMinute: 10, fingerprintPerMinute: 8 },
  vote: { accountPerMinute: 10, ipPerMinute: 60, fingerprintPerMinute: 45, accountPerRollingDay: 30 },
  voteAnomaly: { observeDistinctAccounts: 10, blockDistinctAccounts: 20, windowSeconds: 60 * 60 },
  idempotencyRetentionSeconds: 24 * 60 * 60,
  reputationDailyPositiveCap: 200,
} as const;

export const COMMUNITY_ANTIABUSE_ERROR_CODES = [
  "UNAUTHORIZED", "TRUST_LEVEL_REQUIRED", "TL0_LINK_LIMIT", "TL0_ATTACHMENT_LIMIT",
  "TL0_DAILY_QUOTA_EXCEEDED", "EDIT_WINDOW_EXPIRED", "INVALID_IDEMPOTENCY_KEY",
  "IDEMPOTENCY_CONFLICT", "SELF_VOTE_FORBIDDEN", "RATE_LIMITED", "VOTE_ANOMALY_BLOCKED",
] as const;

export type CommunityAntiabuseErrorCode = (typeof COMMUNITY_ANTIABUSE_ERROR_CODES)[number];

export interface CommunityAntiabuseError {
  error: CommunityAntiabuseErrorCode;
  policy_version: typeof COMMUNITY_ANTIABUSE_VERSION;
  scope?: string;
  limit?: number;
  window_seconds?: number;
  retry_after_seconds?: number;
  required_trust_level?: number;
}

export interface CommunityPolicyHeaders {
  "x-community-policy-version": typeof COMMUNITY_ANTIABUSE_VERSION;
  "x-request-id": string;
}

export interface CommunityAntiabuseDecisionEvent {
  request_id: string;
  policy_version: typeof COMMUNITY_ANTIABUSE_VERSION;
  action: "thread_create" | "post_create" | "content_edit" | "direct_message" | "thread_vote" | "post_vote";
  outcome: "allowed" | "denied" | "observed";
  error_code?: CommunityAntiabuseErrorCode;
  trust_level: 0 | 1 | 2 | 3 | 4;
  subject_type?: "thread" | "post";
  subject_id?: string;
  ip_hash?: string;
  fingerprint_hash?: string;
  idempotency_key_hash?: string;
}
