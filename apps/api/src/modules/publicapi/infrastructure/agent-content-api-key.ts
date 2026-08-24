import { createHash } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { pool } from "../../../db/client.ts";
import { isActiveContentAgent } from "../../agents/public/index.ts";

// Ключ «доступ к сайту» для агентских аккаунтов (MF-2029, docs/epics/agent.accounts.md): тот же
// приём, что research/feed_ingest (createResearchApiKeyVerifier/createFeedIngestApiKeyVerifier) —
// bearer-токен = sha256(key_hash) в user_api_keys, никакого отдельного JWT-секрета не заводим,
// это НЕ device-агентский контур (agentSession.ts), а обычный минтед-ключ пользователя, просто с
// доп. полем agent_id (один пользователь может держать несколько content_agents/ключей — в
// отличие от research/feed_ingest, где ключ = весь сервис-аккаунт). owner_id — это владелец
// (человек), не сам агент; вызывающий код ставит author_id=ownerId, co_author_agent_id=agentId.

export const AGENT_CONTENT_API_KEY_PREFIX = "mf_agent_";
export const AGENT_CONTENT_API_KEY_SCOPE = "agent_content" as const;
export const AGENT_CONTENT_API_KEY_PERMISSION = "write" as const;

export type AgentContentApiKeyPrincipal = {
  id: string;
  ownerId: string;
  agentId: string;
  scope: typeof AGENT_CONTENT_API_KEY_SCOPE;
};

type AgentContentApiKeyRow = { id: string; user_id: string; agent_id: string | null; scope: typeof AGENT_CONTENT_API_KEY_SCOPE };

function hashKey(key: string): Buffer {
  return createHash("sha256").update(key).digest();
}

/** Проверяет только ключ контура agent_content; plaintext в БД не попадает. */
export function createAgentContentApiKeyVerifier(db: Pool | PoolClient = pool) {
  return {
    async verify(rawKey: unknown): Promise<AgentContentApiKeyPrincipal | null> {
      if (typeof rawKey !== "string" || !rawKey.startsWith(AGENT_CONTENT_API_KEY_PREFIX)) return null;

      try {
        const result = await db.query<AgentContentApiKeyRow>(
          `select k.id, k.user_id, k.agent_id, k.scope
           from user_api_keys k
           where k.key_hash = $1 and k.scope = 'agent_content' and k.scopes = array['write']::text[]
             and k.status = 'active' and k.revoked_at is null
             and (k.expires_at is null or k.expires_at > now())
           limit 1`,
          [hashKey(rawKey)],
        );
        const row = result.rows[0];
        if (!row || row.scope !== AGENT_CONTENT_API_KEY_SCOPE || !row.agent_id) return null;
        if (!(await isActiveContentAgent(db, row.agent_id, row.user_id))) return null;

        db.query(`update user_api_keys set last_used_at = now() where id = $1`, [row.id]).catch(() => {});
        return { id: row.id, ownerId: row.user_id, agentId: row.agent_id, scope: row.scope };
      } catch {
        return null;
      }
    },
  };
}

const defaultAgentContentApiKeyVerifier = createAgentContentApiKeyVerifier();
export const verifyAgentContentApiKey = (rawKey: unknown): Promise<AgentContentApiKeyPrincipal | null> => defaultAgentContentApiKeyVerifier.verify(rawKey);
