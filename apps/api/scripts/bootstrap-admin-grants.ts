// Одноразовый защищённый bootstrap grants. Запускать только после миграций:
// ADMIN_USERNAME=portal.admin npx ts-node scripts/bootstrap-admin-grants.ts

import { pool } from "../src/db/client.ts";
import { ALL_PERMISSIONS } from "../src/modules/permissions/public/index.ts";

const REASON = "initial migration from bootstrap owner";

function requiredAdminUsername(): string {
  const username = process.env.ADMIN_USERNAME?.trim();
  if (!username) throw new Error("ADMIN_USERNAME обязателен");
  return username;
}

export async function bootstrapAdminGrants(adminUsername: string): Promise<{ readonly created: number; readonly skipped: number }> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const user = await client.query<{ id: string }>(`select id from users where username = $1 for update`, [adminUsername]);
    const userId = user.rows[0]?.id;
    if (userId === undefined) throw new Error(`Bootstrap-пользователь '${adminUsername}' не найден`);

    let created = 0;
    let skipped = 0;
    for (const permission of ALL_PERMISSIONS) {
      const existing = await client.query(
        `select 1 from permission_grants
         where user_id=$1 and permission=$2 and scope='{}'::jsonb and revoked_at is null`,
        [userId, permission],
      );
      if ((existing.rowCount ?? 0) > 0) {
        skipped += 1;
        continue;
      }
      const grant = await client.query<{ id: string }>(
        `insert into permission_grants(user_id,permission,scope,granted_by,reason,expires_at)
         values($1,$2,'{}'::jsonb,$1,$3,null) returning id`,
        [userId, permission, REASON],
      );
      const grantId = grant.rows[0]?.id;
      if (grantId === undefined) throw new Error(`Не удалось создать grant ${permission}`);
      await client.query(
        `insert into audit_log(actor_user_id,action,target_type,target_id,details)
         values($1,'permission.granted','permission_grant',$2,$3)`,
        [userId, grantId, JSON.stringify({ user_id: userId, permission, reason: REASON })],
      );
      created += 1;
    }
    await client.query("commit");
    return { created, skipped };
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function run(): Promise<void> {
  const result = await bootstrapAdminGrants(requiredAdminUsername());
  console.log(`bootstrap-admin-grants: создано ${result.created}, пропущено ${result.skipped}`);
}

run()
  .then(() => pool.end())
  .catch(async (error: unknown) => {
    console.error(error instanceof Error ? error.message : "bootstrap-admin-grants failed");
    await pool.end().catch(() => undefined);
    process.exitCode = 1;
  });
