import { describe, expect, it } from "vitest";

import { loadAgentBuildInfo, relayIdentityVersion } from "./buildInfo.ts";

describe("loadAgentBuildInfo", () => {
  it("accepts explicit development build metadata without a production default", () => {
    expect(loadAgentBuildInfo({ AGENT_VERSION: "1.2.3", AGENT_COMMIT_SHA: "abcdef1" })).toEqual({ version: "1.2.3", commitSha: "abcdef1" });
  });

  it("fails closed for absent or malformed metadata", () => {
    expect(loadAgentBuildInfo({})).toBeNull();
    expect(loadAgentBuildInfo({ AGENT_VERSION: "0.0", AGENT_COMMIT_SHA: "not-a-sha" })).toBeNull();
  });

  it("includes the release commit in Relay identity without changing the wire shape", () => {
    expect(relayIdentityVersion({ version: "1.2.3", commitSha: "abcdef1234567890" })).toBe("1.2.3+commit.abcdef123456");
    expect(relayIdentityVersion({ version: "1.2.3+canary.1", commitSha: "abcdef1234567890" })).toBe("1.2.3+canary.1.commit.abcdef123456");
  });
});
