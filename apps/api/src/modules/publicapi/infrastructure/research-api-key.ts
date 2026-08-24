import { createHash } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { UserId } from "../../_kernel/brandedIds.ts";
import type { ProfileAuthPort } from "../../profile/public/index.ts";
import type { MetricsService } from "../../../nest/observability/metrics.service.ts";

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
  status: string;
  revoked_at: Date | null;
  expires_at: Date | null;
};

function hashKey(key: string): Buffer {
  return createHash("sha256").update(key).digest();
}

/** Проверяет только ключ машинного контура research; plaintext в БД не попадает. */
export function createResearchApiKeyVerifier(db: Pool | PoolClient, profiles: ProfileAuthPort, metrics?: MetricsService) {
  return {
    async verify(rawKey: unknown): Promise<ResearchApiKeyPrincipal | null> {
      if (typeof rawKey !== "string") return null;
      if (!rawKey.startsWith(RESEARCH_API_KEY_PREFIX)) {
        metrics?.incRevokedCredentialUse("research_key", "revoked");
        return null;
      }

      try {
        const result = await db.query<ResearchApiKeyRow>(
          `select id, user_id, scope, status, revoked_at, expires_at from user_api_keys
           where key_hash = $1 and scope = 'research' and scopes = array['write']::text[]
           limit 1`,
          [hashKey(rawKey)],
        );
        const row = result.rows[0];
        if (!row || row.scope !== RESEARCH_API_KEY_SCOPE) {
          metrics?.incRevokedCredentialUse("research_key", "revoked");
          return null;
        }
        if (row.status !== "active" || row.revoked_at !== null || (row.expires_at !== null && row.expires_at <= new Date())) {
          metrics?.incRevokedCredentialUse("research_key", "revoked");
          return null;
        }
        const owner = await profiles.loadOwnerAuthState(UserId(row.user_id));
        if (owner === null) {
          metrics?.incRevokedCredentialUse("research_key", "unknown");
          return null;
        }
        if (owner.status !== "active") {
          metrics?.incRevokedCredentialUse("research_key", "user_blocked");
          return null;
        }

        db.query(`update user_api_keys set last_used_at = now() where id = $1`, [row.id]).catch(() => {});
        return { id: row.id, userId: row.user_id, scope: row.scope };
      } catch {
        metrics?.incRevokedCredentialUse("research_key", "unknown");
        return null;
      }
    },
  };
}
