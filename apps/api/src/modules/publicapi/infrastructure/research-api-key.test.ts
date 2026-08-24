import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { createResearchApiKeyVerifier, RESEARCH_API_KEY_PREFIX } from "./research-api-key.ts";

const secret = `${RESEARCH_API_KEY_PREFIX}fixture-secret`;
const row = { id: "key-1", user_id: "researcher-1", scope: "research" as const };
const profiles = { loadOwnerAuthState: vi.fn().mockResolvedValue({ status: "active", sessionVersion: 1 }) };

function database(rows: (typeof row)[] = []) {
  return { query: vi.fn().mockResolvedValue({ rows, rowCount: rows.length }) };
}

describe("проверка research API-ключа", () => {
  it("принимает только активный ключ с research scope", async () => {
    const db = database([row]);

    await expect(createResearchApiKeyVerifier(db as never, profiles as never).verify(secret)).resolves.toEqual({
      id: "key-1",
      userId: "researcher-1",
      scope: "research",
    });
  });

  it.each([
    ["пустой ключ", ""],
    ["неверный префикс", "mf_pub_fixture-secret"],
    ["публичный scope", secret],
  ])("отказывает: %s", async (_name, rawKey) => {
    const db = database(_name === "публичный scope" ? [{ ...row, scope: "public_api" as never }] : []);
    await expect(createResearchApiKeyVerifier(db as never, profiles as never).verify(rawKey)).resolves.toBeNull();
  });

  it("передаёт в БД только SHA-256 и фильтрует active/research", async () => {
    const db = database([row]);
    await createResearchApiKeyVerifier(db as never, profiles as never).verify(secret);

    const [sql, params] = db.query.mock.calls[0] as [string, unknown[]];
    expect(params).toEqual([createHash("sha256").update(secret).digest()]);
    expect(params).not.toContain(secret);
    expect(sql).toContain("scope = 'research'");
    expect(sql).toContain("status = 'active'");
    expect(sql).toContain("revoked_at is null");
    expect(sql).toContain("expires_at is null or expires_at > now()");
  });

  it("rejects an inactive key owner", async () => {
    const db = database([row]);
    const blockedProfiles = { loadOwnerAuthState: vi.fn().mockResolvedValue({ status: "banned", sessionVersion: 1 }) };
    await expect(createResearchApiKeyVerifier(db as never, blockedProfiles as never).verify(secret)).resolves.toBeNull();
  });
});
