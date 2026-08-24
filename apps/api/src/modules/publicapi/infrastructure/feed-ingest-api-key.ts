import { createHash } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { UserId } from "../../_kernel/brandedIds.ts";
import type { ProfileAuthPort } from "../../profile/public/index.ts";
import type { MetricsService } from "../../../nest/observability/metrics.service.ts";

// Ключ AI-ingest ленты (MF-1926): отдельный scope/префикс от research/public_api — карточка явно
// требует не переиспользовать их машинный контур и не выдавать глобальный admin. Единственное
// право внутри `feed_ingest` — `write` (тот же приём, что research, миграция
// 20260718210000_feed_ingest_scope.sql). Сам ключ только удостоверяет "это service-user X" —
// доступ к КОНКРЕТНОМУ сабу проверяет вызывающий код (feed/ingest.ts) через community_members
// (owner/moderator), не эта функция.

export const FEED_INGEST_API_KEY_PREFIX = "mf_feedingest_";
export const FEED_INGEST_API_KEY_SCOPE = "feed_ingest" as const;
export const FEED_INGEST_API_KEY_PERMISSION = "write" as const;

export type FeedIngestApiKeyPrincipal = {
  id: string;
  userId: string;
  scope: typeof FEED_INGEST_API_KEY_SCOPE;
};

type FeedIngestApiKeyRow = { id: string; user_id: string; scope: typeof FEED_INGEST_API_KEY_SCOPE; status: string; revoked_at: Date | null; expires_at: Date | null };

function hashKey(key: string): Buffer {
  return createHash("sha256").update(key).digest();
}

/** Проверяет только ключ машинного контура feed_ingest; plaintext в БД не попадает. */
export function createFeedIngestApiKeyVerifier(db: Pool | PoolClient, profiles: ProfileAuthPort, metrics?: MetricsService) {
  return {
    async verify(rawKey: unknown): Promise<FeedIngestApiKeyPrincipal | null> {
      if (typeof rawKey !== "string") return null;
      if (!rawKey.startsWith(FEED_INGEST_API_KEY_PREFIX)) {
        metrics?.incRevokedCredentialUse("feed_ingest_key", "revoked");
        return null;
      }

      try {
        const result = await db.query<FeedIngestApiKeyRow>(
          `select id, user_id, scope, status, revoked_at, expires_at from user_api_keys
           where key_hash = $1 and scope = 'feed_ingest' and scopes = array['write']::text[]
           limit 1`,
          [hashKey(rawKey)],
        );
        const row = result.rows[0];
        if (!row || row.scope !== FEED_INGEST_API_KEY_SCOPE) {
          metrics?.incRevokedCredentialUse("feed_ingest_key", "revoked");
          return null;
        }
        if (row.status !== "active" || row.revoked_at !== null || (row.expires_at !== null && row.expires_at <= new Date())) {
          metrics?.incRevokedCredentialUse("feed_ingest_key", "revoked");
          return null;
        }
        const owner = await profiles.loadOwnerAuthState(UserId(row.user_id));
        if (owner === null) {
          metrics?.incRevokedCredentialUse("feed_ingest_key", "unknown");
          return null;
        }
        if (owner.status !== "active") {
          metrics?.incRevokedCredentialUse("feed_ingest_key", "user_blocked");
          return null;
        }

        db.query(`update user_api_keys set last_used_at = now() where id = $1`, [row.id]).catch(() => {});
        return { id: row.id, userId: row.user_id, scope: row.scope };
      } catch {
        metrics?.incRevokedCredentialUse("feed_ingest_key", "unknown");
        return null;
      }
    },
  };
}
