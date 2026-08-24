import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "./password-hash.ts";

describe("password hash", () => {
  it("verifies the matching password and rejects a different one", async () => {
    const encoded = await hashPassword("correct horse battery staple");

    await expect(verifyPassword("correct horse battery staple", encoded)).resolves.toBe(true);
    await expect(verifyPassword("wrong password", encoded)).resolves.toBe(false);
  });

  it("uses a unique salt for each credential", async () => {
    const first = await hashPassword("correct horse battery staple");
    const second = await hashPassword("correct horse battery staple");

    expect(first).not.toBe(second);
    await expect(verifyPassword("correct horse battery staple", second)).resolves.toBe(true);
  });

  it.each(["", "plaintext", "scrypt$1$2$3$bad$bad"])("rejects malformed credential %j", async (encoded) => {
    await expect(verifyPassword("irrelevant", encoded)).resolves.toBe(false);
  });
});
