import { Inject, Injectable } from "@nestjs/common";
import type { Pool } from "pg";
import { DATABASE_POOL } from "../../../nest/database/database.constants.ts";
import { UserId, type UserId as UserIdType } from "../../_kernel/brandedIds.ts";
import type { AuthIdentityReadPort } from "../public/index.ts";
import { activateBootstrapAdminUser, claimBootstrapAdminUser } from "../../profile/public/legacy.ts";

export interface PasswordCredentialUser {
  readonly id: UserIdType;
  readonly username: string;
  readonly passwordHash: string;
}

interface OtpRow {
  readonly id: string;
  readonly otp_hash: Buffer;
  readonly attempts: number;
  readonly expires_at: Date | string;
}

@Injectable()
export class AuthRepository implements AuthIdentityReadPort {
  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {}

  async latestOtpCreatedAt(emailHash: Buffer): Promise<Date | null> {
    const result = await this.pool.query<{ created_at: Date | string }>(`select created_at from email_otp where email_hash = $1 order by created_at desc limit 1`, [emailHash]);
    const value = result.rows[0]?.created_at;
    return value === undefined ? null : new Date(value);
  }

  async createOtp(emailHash: Buffer, otpHash: Buffer, expiresAt: Date): Promise<void> {
    await this.pool.query(`insert into email_otp (email_hash, otp_hash, expires_at) values ($1, $2, $3)`, [emailHash, otpHash, expiresAt]);
  }

  async latestOtp(emailHash: Buffer): Promise<OtpRow | null> {
    const result = await this.pool.query<OtpRow>(`select id, otp_hash, attempts, expires_at from email_otp where email_hash = $1 order by created_at desc limit 1`, [emailHash]);
    return result.rows[0] ?? null;
  }

  async incrementOtpAttempts(id: string): Promise<void> {
    await this.pool.query(`update email_otp set attempts = attempts + 1 where id = $1`, [id]);
  }

  async consumeOtp(id: string): Promise<void> {
    await this.pool.query(`delete from email_otp where id = $1`, [id]);
  }

  async findIdentity(provider: "email_corp" | "plag_id", hash: Buffer): Promise<UserIdType | null> {
    const result = await this.pool.query<{ user_id: string }>(`select user_id from user_identities where provider = $1 and identifier_hash = $2`, [provider, hash]);
    const row = result.rows[0];
    return row === undefined ? null : UserId(row.user_id);
  }

  async createIdentity(userId: UserIdType, provider: "email_corp" | "plag_id", hash: Buffer, s3Key: string): Promise<void> {
    await this.pool.query(`insert into user_identities (user_id, provider, identifier_hash, s3_key) values ($1, $2, $3, $4)`, [userId, provider, hash, s3Key]);
  }

  async hasVerifiedIdentity(userId: UserIdType): Promise<boolean> {
    return (await this.pool.query(`select 1 from user_identities where user_id = $1 limit 1`, [userId])).rowCount !== 0;
  }

  async findPasswordCredential(username: string): Promise<PasswordCredentialUser | null> {
    const result = await this.pool.query<{ id: string; username: string; password_hash: string }>(
      `select u.id, u.username, credentials.password_hash
       from users u
       join user_password_credentials credentials on credentials.user_id = u.id
       where u.username = $1 and u.status = 'active'`,
      [username],
    );
    const row = result.rows[0];
    return row === undefined
      ? null
      : {
          id: UserId(row.id),
          username: row.username,
          passwordHash: row.password_hash,
        };
  }

  async upsertBootstrapAdmin(username: string, passwordHash: string, updatePassword: boolean): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const claimed = await claimBootstrapAdminUser(client, username);
      if (!claimed.created) {
        const existingCredential = await client.query(`select 1 from user_password_credentials where user_id = $1`, [claimed.id]);
        if ((existingCredential.rowCount ?? 0) === 0) {
          throw new Error("ADMIN_USERNAME is already owned by a non-bootstrap account");
        }
      }
      await activateBootstrapAdminUser(client, claimed.id);

      await client.query(
        `insert into user_password_credentials (user_id, password_hash)
         values ($1, $2)
         on conflict (user_id) do update set
           password_hash = excluded.password_hash,
           updated_at = now()
         where $3`,
        [claimed.id, passwordHash, updatePassword],
      );
      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }
}
