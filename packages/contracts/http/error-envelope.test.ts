import { describe, expect, it } from "vitest";
import {
  API_ERROR_CODES,
  API_ERROR_CONTRACT_VERSION,
  isApiErrorEnvelope,
} from "./error-envelope.ts";

describe("api-error.v1 HTTP contract", () => {
  it("accepts the versioned Nest error envelope", () => {
    expect(API_ERROR_CONTRACT_VERSION).toBe("api-error.v1");
    expect(isApiErrorEnvelope({
      error: {
        code: "auth.unauthorized.v1",
        message: "Требуется авторизация",
        requestId: "11111111-1111-4111-8111-111111111111",
      },
    })).toBe(true);
  });

  it("rejects legacy and unknown error bodies", () => {
    expect(isApiErrorEnvelope({ error: "unauthorized" })).toBe(false);
    expect(isApiErrorEnvelope({
      error: {
        code: "auth.unknown.v2",
        message: "denied",
        requestId: "request-id",
      },
    })).toBe(false);
    expect(API_ERROR_CODES).toContain("http.internal.v1");
  });
});
