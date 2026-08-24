import { describe, expect, it } from "vitest";
import { CorrelationContext } from "./correlation-context.ts";

describe("CorrelationContext", () => {
  it("preserves a safe correlation id across async work", async () => {
    const context = new CorrelationContext();
    await context.run("request-123", async () => {
      await Promise.resolve();
      expect(context.currentId).toBe("request-123");
    });
    expect(context.currentId).toBeUndefined();
  });

  it("replaces unsafe inbound identifiers", () => {
    const context = new CorrelationContext();
    context.run("token value\n", () => expect(context.currentId).toMatch(/^[0-9a-f-]{36}$/));
  });
});
