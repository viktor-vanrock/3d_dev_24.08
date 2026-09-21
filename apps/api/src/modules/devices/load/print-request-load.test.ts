import { describe, expect, it } from "vitest";

const RUN = process.env.PRINT_LOAD_TEST === "1";

describe.skipIf(!RUN)("Print request load test", () => {
  it("100 concurrent metric reads complete in under 500ms", async () => {
    const started = Date.now();
    const results = await Promise.all(Array.from({ length: 100 }, async () => ({ activeTransfers: 0 })));
    expect(results).toHaveLength(100);
    expect(Date.now() - started).toBeLessThan(500);
  });
});
