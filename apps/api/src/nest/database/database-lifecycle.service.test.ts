import type { Pool } from "pg";
import { describe, expect, it } from "vitest";
import { DatabaseLifecycle } from "./database-lifecycle.service.ts";

describe("DatabaseLifecycle", () => {
  it("awaits the Nest-owned pool shutdown during application termination", async () => {
    let closed = false;
    const pool = {
      end: () => {
        closed = true;
        return Promise.resolve();
      },
    };

    await new DatabaseLifecycle(pool as unknown as Pool).onApplicationShutdown("SIGTERM");
    expect(closed).toBe(true);
  });
});
