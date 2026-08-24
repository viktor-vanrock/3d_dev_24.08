import { createHash } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { UserId } from "../../_kernel/brandedIds.ts";
import type { ProfileAuthPort } from "../../profile/public/index.ts";

export const RESEARCH_API_KEY_PREFIX = "mf_research_";
export const RESEARCH_API_KEY_SCOPE = "research" as const;
export const RESEARCH_API_KEY_PERMISSION = "write" as const;

export type ResearchApiKeyPrincipal = {
  id: string;
  userId: string;
  scope: typeof RESEARCH_API_KEY_SCOPE;
};

type ResearchApiKeyRow = {
  id: string;
  user_id: string;
  scope: typeof RESEARCH_API_KEY_SCOPE;
};

function hashKey(key: string): Buffer {
  return createHash("sha256").update(key).digest();
}

/** Проверяет только ключ машинного контура research; plaintext в БД не попадает. */
export function createResearchApiKeyVerifier(db: Pool | PoolClient, profiles: ProfileAuthPort) {
  return {
    async verify(rawKey: unknown): Promise<ResearchApiKeyPrincipal | null> {
      if (typeof rawKey !== "string" || !rawKey.startsWith(RESEARCH_API_KEY_PREFIX)) return null;

      try {
        const result = await db.query<ResearchApiKeyRow>(
          `select id, user_id, scope from user_api_keys
           where key_hash = $1 and scope = 'research' and scopes = array['write']::text[]
             and status = 'active'
             and revoked_at is null
             and (expires_at is null or expires_at > now())
           limit 1`,
          [hashKey(rawKey)],
        );
        const row = result.rows[0];
        if (!row || row.scope !== RESEARCH_API_KEY_SCOPE) return null;
        const owner = await profiles.loadOwnerAuthState(UserId(row.user_id));
        if (owner === null || owner.status !== "active") return null;

        db.query(`update user_api_keys set last_used_at = now() where id = $1`, [row.id]).catch(() => {});
        return { id: row.id, userId: row.user_id, scope: row.scope };
      } catch {
        return null;
      }
    },
  };
}
