import { describe, it } from "vitest";

describe.skipIf(!process.env.DATABASE_URL)("Decision idempotency", () => {
  it.todo("returns the same decision for an identical idempotency key");
  it.todo("rejects a reused key with a different payload");
  it.todo("writes one audit event for idempotent retries");
  it.todo("writes one content restriction for idempotent retries");
});
