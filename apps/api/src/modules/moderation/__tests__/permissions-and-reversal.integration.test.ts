import { describe, it } from "vitest";

describe.skipIf(!process.env.DATABASE_URL)("Moderation permissions and reversal", () => {
  it.todo("leaves legacy moderation_actions unchanged");
  it.todo("reverses a decision and records an audit event");
  it.todo("lifts a linked content restriction atomically");
});
