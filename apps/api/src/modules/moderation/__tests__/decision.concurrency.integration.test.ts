import { describe, it } from "vitest";

describe.skipIf(!process.env.DATABASE_URL)("Moderation decision concurrency", () => {
  it.todo("concurrent claims have exactly one winner");
  it.todo("replaces an expired claim");
  it.todo("prevents another moderator from releasing a claim");
});
