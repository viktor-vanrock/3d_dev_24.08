import { describe, expect, it } from "vitest";
import { decryptIdentity, encryptIdentity } from "./auth-crypto.ts";

describe("encryptIdentity / decryptIdentity", () => {
  it("round-trips an arbitrary JSON payload", () => {
    const payload = { api_key: "sk-test-123", nested: { ok: true } };
    const encrypted = encryptIdentity(payload);
    expect(encrypted.toString("utf8")).not.toContain("sk-test-123");
    expect(decryptIdentity(encrypted)).toEqual(payload);
  });

  it("fails to decrypt if the ciphertext was tampered with", () => {
    const encrypted = encryptIdentity({ api_key: "sk-test-123" });
    encrypted[encrypted.length - 1] = encrypted[encrypted.length - 1]! ^ 0xff;
    expect(() => decryptIdentity(encrypted)).toThrow();
  });
});
