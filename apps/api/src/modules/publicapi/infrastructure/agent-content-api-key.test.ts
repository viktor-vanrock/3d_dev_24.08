import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { AGENT_CONTENT_API_KEY_PREFIX, createAgentContentApiKeyVerifier } from "./agent-content-api-key.ts";

const secret = `${AGENT_CONTENT_API_KEY_PREFIX}fixture-secret`;
const row: { id: string; user_id: string; agent_id: string | null; scope: string; status: string; revoked_at: Date | null; expires_at: Date | null } = {
  id: "key-1",
  user_id: "owner-1",
  agent_id: "agent-1",
  scope: "agent_content",
  status: "active",
  revoked_at: null,
  expires_at: null,
};
const profiles = { loadOwnerAuthState: vi.fn().mockResolvedValue({ status: "active", sessionVersion: 1 }) };

function database(rows: (typeof row)[] = []) {
  return { query: vi.fn().mockResolvedValue({ rows, rowCount: rows.length }) };
}

describe("проверка agent_content API-ключа", () => {
  it("принимает только активный ключ с agent_content scope, живым агентом и agent_id", async () => {
    const db = database([row]);

    await expect(createAgentContentApiKeyVerifier(db as never, profiles as never).verify(secret)).resolves.toEqual({
      id: "key-1",
      ownerId: "owner-1",
      agentId: "agent-1",
      scope: "agent_content",
    });
  });

  it.each([
    ["пустой ключ", ""],
    ["неверный префикс", "mf_research_fixture-secret"],
    ["research scope", secret],
  ])("отказывает: %s", async (name, rawKey) => {
    const db = database(name === "research scope" ? [{ ...row, scope: "research" as never }] : []);
    await expect(createAgentContentApiKeyVerifier(db as never, profiles as never).verify(rawKey)).resolves.toBeNull();
  });

  it("отказывает, если agent_id отсутствует (симметрия с provider у printer-scope)", async () => {
    const db = database([{ ...row, agent_id: null }]);
    await expect(createAgentContentApiKeyVerifier(db as never, profiles as never).verify(secret)).resolves.toBeNull();
  });

  it("передаёт в owner queries только SHA-256 и проверяет активного content agent", async () => {
    const db = database([row]);
    await createAgentContentApiKeyVerifier(db as never, profiles as never).verify(secret);

    const [keySql, keyParams] = db.query.mock.calls[0] as [string, unknown[]];
    expect(keyParams).toEqual([createHash("sha256").update(secret).digest()]);
    expect(keyParams).not.toContain(secret);
    expect(keySql).toContain("scope = 'agent_content'");
    expect(keySql).toContain("k.status");
    expect(keySql).toContain("k.revoked_at");
    expect(keySql).toContain("k.expires_at");

    const [agentSql, agentParams] = db.query.mock.calls[1] as [string, unknown[]];
    expect(agentSql).toContain("from content_agents");
    expect(agentSql).toContain("status='active'");
    expect(agentParams).toEqual([row.agent_id, row.user_id]);
  });

  it("rejects an inactive key owner", async () => {
    const db = database([row]);
    const blockedProfiles = { loadOwnerAuthState: vi.fn().mockResolvedValue({ status: "restricted", sessionVersion: 1 }) };
    const metrics = { incRevokedCredentialUse: vi.fn() };
    await expect(createAgentContentApiKeyVerifier(db as never, blockedProfiles as never, metrics as never).verify(secret)).resolves.toBeNull();
    expect(metrics.incRevokedCredentialUse).toHaveBeenCalledWith("agent_content_key", "user_blocked");
  });
});
