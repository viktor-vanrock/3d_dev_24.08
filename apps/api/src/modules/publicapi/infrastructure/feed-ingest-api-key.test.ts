import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { createFeedIngestApiKeyVerifier, FEED_INGEST_API_KEY_PREFIX } from "./feed-ingest-api-key.ts";

const secret = `${FEED_INGEST_API_KEY_PREFIX}fixture-secret`;
const row = { id: "key-1", user_id: "vendor-bot-1", scope: "feed_ingest" as const };
const profiles = { loadOwnerAuthState: vi.fn().mockResolvedValue({ status: "active", sessionVersion: 1 }) };

function database(rows: (typeof row)[] = []) {
  return { query: vi.fn().mockResolvedValue({ rows, rowCount: rows.length }) };
}

describe("проверка feed_ingest API-ключа", () => {
  it("принимает только активный ключ с feed_ingest scope", async () => {
    const db = database([row]);

    await expect(createFeedIngestApiKeyVerifier(db as never, profiles as never).verify(secret)).resolves.toEqual({
      id: "key-1",
      userId: "vendor-bot-1",
      scope: "feed_ingest",
    });
  });

  it.each([
    ["пустой ключ", ""],
    ["неверный префикс (research)", "mf_research_fixture-secret"],
    ["неверный префикс (public_api)", "mf_pub_fixture-secret"],
    ["research scope", secret],
  ])("отказывает: %s", async (name, rawKey) => {
    const db = database(name === "research scope" ? [{ ...row, scope: "research" as never }] : []);
    await expect(createFeedIngestApiKeyVerifier(db as never, profiles as never).verify(rawKey)).resolves.toBeNull();
  });

  it("передаёт в БД только SHA-256 и фильтрует active/feed_ingest", async () => {
    const db = database([row]);
    await createFeedIngestApiKeyVerifier(db as never, profiles as never).verify(secret);

    const [sql, params] = db.query.mock.calls[0] as [string, unknown[]];
    expect(params).toEqual([createHash("sha256").update(secret).digest()]);
    expect(params).not.toContain(secret);
    expect(sql).toContain("scope = 'feed_ingest'");
    expect(sql).toContain("status = 'active'");
    expect(sql).toContain("revoked_at is null");
    expect(sql).toContain("expires_at is null or expires_at > now()");
  });

  it("rejects an inactive key owner", async () => {
    const db = database([row]);
    const blockedProfiles = { loadOwnerAuthState: vi.fn().mockResolvedValue({ status: "banned", sessionVersion: 1 }) };
    await expect(createFeedIngestApiKeyVerifier(db as never, blockedProfiles as never).verify(secret)).resolves.toBeNull();
  });
});
