import type { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";

import { assertExplicitOperationalTarget, assertSafeBootstrapTarget, assertSafeDevSeed } from "./dev-seed-guard.ts";

function database(name: string): Pool {
  return { query: vi.fn().mockResolvedValue({ rows: [{ db: name }] }) } as unknown as Pool;
}

describe("assertSafeDevSeed", () => {
  it("accepts only the explicitly expected development database", async () => {
    await expect(assertSafeDevSeed(database("portal_dev"), { DATABASE_URL: "postgres://dev", NODE_ENV: "development" })).resolves.toBeUndefined();
  });

  it("rejects missing configuration before querying", async () => {
    const pool = database("portal_dev");
    await expect(assertSafeDevSeed(pool, { NODE_ENV: "development" })).rejects.toThrow("DATABASE_URL");
    expect(pool.query).not.toHaveBeenCalled();
  });

  it("rejects production mode before querying", async () => {
    const pool = database("portal_dev");
    await expect(assertSafeDevSeed(pool, { DATABASE_URL: "postgres://dev", NODE_ENV: "production" })).rejects.toThrow("NODE_ENV=production");
    expect(pool.query).not.toHaveBeenCalled();
  });

  it("rejects the protected production database regardless of the expected name", async () => {
    await expect(assertSafeDevSeed(database("portal"), { DATABASE_URL: "postgres://prod", SEED_DB_NAME: "portal" })).rejects.toThrow("прод-БД 'portal'");
  });

  it("rejects any unexpected database", async () => {
    await expect(assertSafeDevSeed(database("portal_test"), { DATABASE_URL: "postgres://test" })).rejects.toThrow("ожидается 'portal_dev'");
  });
});

describe("operational mutation target guards", () => {
  it("rejects bootstrap writes to production and protected database targets", async () => {
    await expect(assertSafeBootstrapTarget(database("portal_dev"), { DATABASE_URL: "postgres://dev", NODE_ENV: "production" })).rejects.toThrow("NODE_ENV=production");
    await expect(assertSafeBootstrapTarget(database("portal"), { DATABASE_URL: "postgres://prod", BOOTSTRAP_DB_NAME: "portal" })).rejects.toThrow("protected database");
  });

  it("rejects bootstrap writes unless the resolved database is the expected safe target", async () => {
    await expect(assertSafeBootstrapTarget(database("portal_test"), { DATABASE_URL: "postgres://test" })).rejects.toThrow("BOOTSTRAP_DB_NAME='portal_dev'");
    await expect(assertSafeBootstrapTarget(database("portal_test"), { DATABASE_URL: "postgres://test", BOOTSTRAP_DB_NAME: "portal_test" })).resolves.toBeUndefined();
  });

  it("requires an exact explicit target for production-capable operational mutations", async () => {
    const pool = database("portal_test");
    await expect(assertExplicitOperationalTarget(pool, "provision researcher", "PROVISION_RESEARCHER_DB_NAME", { DATABASE_URL: "postgres://test" })).rejects.toThrow(
      "must explicitly name",
    );
    await expect(
      assertExplicitOperationalTarget(pool, "provision researcher", "PROVISION_RESEARCHER_DB_NAME", {
        DATABASE_URL: "postgres://test",
        PROVISION_RESEARCHER_DB_NAME: "other",
      }),
    ).rejects.toThrow("does not match");
    await expect(
      assertExplicitOperationalTarget(pool, "provision researcher", "PROVISION_RESEARCHER_DB_NAME", {
        DATABASE_URL: "postgres://test",
        PROVISION_RESEARCHER_DB_NAME: "portal_test",
      }),
    ).resolves.toBeUndefined();
  });
});
