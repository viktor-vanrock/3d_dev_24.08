import { describe, expect, it } from "vitest";
import { deterministicAvatarConfig, parseAvatarConfig, sanitizeContacts } from "./profile.ts";

describe("profile boundary normalization", () => {
  it("trims contacts and rejects malformed entries", () => {
    expect(sanitizeContacts([{ label: " Site ", url: " https://example.test " }])).toEqual([{ label: "Site", url: "https://example.test" }]);
    expect(sanitizeContacts([{ label: "", url: "https://example.test" }])).toBeNull();
    expect(sanitizeContacts("not-an-array")).toBeNull();
  });

  it("keeps deterministic mascot generation and strict layer allowlists", () => {
    const config = deterministicAvatarConfig("11111111-1111-4111-8111-111111111111");
    expect(deterministicAvatarConfig("11111111-1111-4111-8111-111111111111")).toEqual(config);
    expect(parseAvatarConfig(config)).toEqual(config);
    expect(parseAvatarConfig({ ...config, color: "unknown" })).toBeNull();
  });
});
