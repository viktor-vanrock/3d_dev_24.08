import { describe, expect, it } from "vitest";
import { assertSafePayload } from "./audit-log.service.ts";

describe("audit payload guard", () => {
  for (const field of ["password", "token", "cookie", "secret", "verificationCode"] as const) {
    it(`rejects ${field}`, () => expect(() => assertSafePayload({ [field]: "sensitive" } as never)).toThrow(field));
  }
  it("accepts a clean payload", () => expect(() => assertSafePayload({ reason_code: "expired", nested: { stable: true } })).not.toThrow());
});
