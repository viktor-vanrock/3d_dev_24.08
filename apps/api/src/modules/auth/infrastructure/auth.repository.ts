import { Inject, Injectable, Optional } from "@nestjs/common";
import type { Pool } from "pg";
import { DATABASE_POOL } from "../../../nest/database/database.constants.ts";
import { UserId, type UserId as UserIdType } from "../../_kernel/brandedIds.ts";
import type { AuthIdentityReadPort } from "../public/index.ts";
import { activateBootstrapAdminUser, claimBootstrapAdminUser } from "../../profile/public/legacy.ts";
import { SANCTIONS_READ_PORT, type SanctionsReadPort } from "../../sanctions/public/index.ts";

export interface PasswordCredentialUser {
  readonly id: UserIdType;
  readonly username: string;
  readonly passwordHash: string;
}

export interface AuthSessionRow {
  readonly id: string;
  readonly user_id: string;
  readonly created_at: Date | string;
  readonly last_active_at: Date | string;
  readonly session_token_hash: string;
}

export interface PendingRegistrationInput {
  readonly emailHash: Buffer;
  readonly identityKey: string;
  readonly handle: string;
  readonly displayName: string;
  readonly gender: string | null;
  readonly birthYear: number | null;
  readonly passwordHash: string;
}

interface OtpRow {
  readonly id: string;
  readonly otp_hash: Buffer;
  readonly attempts: number;
  readonly expires_at: Date | string;
  readonly created_at: Date | string;
  readonly block_until: Date | string | null;
}

@Injectable()
export class AuthRepository implements AuthIdentityReadPort {
  constructor(
    @Inject(DATABASE_POOL) private readonly pool: Pool,
    @Optional() @Inject(SANCTIONS_READ_PORT) private readonly sanctions?: SanctionsReadPort,
  ) {}

  async latestOtpCreatedAt(emailHash: Buffer): Promise<Date | null> {
    const result = await this.pool.query<{ created_at: Date | string }>(`select created_at from email_otp where email_hash = $1 order by created_at desc limit 1`, [emailHash]);
    const value = result.rows[0]?.created_at;
    return value === undefined ? null : new Date(value);
  }

  async createSession(userId: UserIdType, tokenHash: string, id: string): Promise<AuthSessionRow> {
    const result = await this.pool.query<AuthSessionRow>(
      `insert into sessions (id, user_id, session_token_hash) values ($1, $2, $3)
       returning id, user_id, created_at, last_active_at, session_token_hash`,
      [id, userId, tokenHash],
    );
    if (result.rows[0] === undefined) throw new Error("session insert failed");
    return result.rows[0];
  }

  async getSessionsByUserId(userId: UserIdType): Promise<readonly AuthSessionRow[]> {
    return (await this.pool.query<AuthSessionRow>(`select id, user_id, created_at, last_active_at, session_token_hash from sessions where user_id = $1 order by created_at desc`, [userId])).rows;
  }

  async getSessionById(id: string): Promise<AuthSessionRow | null> {
    return (await this.pool.query<AuthSessionRow>(`select id, user_id, created_at, last_active_at, session_token_hash from sessions where id = $1`, [id])).rows[0] ?? null;
  }

  async deleteSessionById(id: string): Promise<void> {
    await this.pool.query(`delete from sessions where id = $1`, [id]);
  }

  async deleteAllSessionsByUserId(userId: UserIdType, exceptId?: string): Promise<void> {
    await this.pool.query(exceptId === undefined ? `delete from sessions where user_id = $1` : `delete from sessions where user_id = $1 and id <> $2`, exceptId === undefined ? [userId] : [userId, exceptId]);
  }

  async updateLastActive(id: string): Promise<void> {
    await this.pool.query(`update sessions set last_active_at = now() where id = $1`, [id]);
  }

  async createOtp(emailHash: Buffer, otpHash: Buffer, expiresAt: Date): Promise<void> {
    await this.pool.query(`insert into email_otp (email_hash, otp_hash, expires_at) values ($1, $2, $3)`, [emailHash, otpHash, expiresAt]);
  }

  async latestOtp(emailHash: Buffer): Promise<OtpRow | null> {
    const result = await this.pool.query<OtpRow>(`select id, otp_hash, attempts, expires_at, created_at, block_until from email_otp where email_hash = $1 order by created_at desc limit 1`, [emailHash]);
    return result.rows[0] ?? null;
  }

  async incrementOtpAttempts(id: string, blockUntil: Date | null): Promise<void> {
    await this.pool.query(`update email_otp set attempts = attempts + 1, block_until = coalesce($2, block_until) where id = $1`, [id, blockUntil]);
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

  async createPendingRegistration(input: PendingRegistrationInput): Promise<boolean> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const existing = await client.query(`select 1 from user_identities where provider = 'email_corp' and identifier_hash = $1`, [input.emailHash]);
      if ((existing.rowCount ?? 0) !== 0) {
        await client.query("rollback");
        return false;
      }
      const user = await client.query<{ id: string }>(
        `insert into users (username, display_name, gender, birth_year, status, handle_confirmed)
         values ($1, $2, $3, $4, 'restricted', false) returning id`,
        [input.handle, input.displayName, input.gender, input.birthYear],
      );
      const userId = user.rows[0]?.id;
      if (userId === undefined) throw new Error("registration user insert failed");
      await client.query(`insert into user_identities (user_id, provider, identifier_hash, s3_key) values ($1, 'email_corp', $2, $3)`, [userId, input.emailHash, input.identityKey]);
      await client.query(`insert into auth_pending_registrations (user_id, password_hash) values ($1, $2)`, [userId, input.passwordHash]);
      await client.query("commit");
      return true;
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async hasPendingRegistration(emailHash: Buffer): Promise<boolean> {
    const result = await this.pool.query(
      `select 1
       from user_identities identities
       join auth_pending_registrations pending on pending.user_id = identities.user_id
       where identities.provider = 'email_corp' and identities.identifier_hash = $1`,
      [emailHash],
    );
    return (result.rowCount ?? 0) !== 0;
  }

  async activatePendingRegistration(emailHash: Buffer): Promise<PasswordCredentialUser | null> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const result = await client.query<{ id: string; username: string; password_hash: string }>(
        `select u.id, u.username, pending.password_hash
         from users u join user_identities identities on identities.user_id = u.id
         join auth_pending_registrations pending on pending.user_id = u.id
         where identities.provider = 'email_corp' and identities.identifier_hash = $1 for update`,
        [emailHash],
      );
      const row = result.rows[0];
      if (row === undefined) { await client.query("rollback"); return null; }
      await client.query(`update users set status = 'active', updated_at = now() where id = $1`, [row.id]);
      await client.query(`insert into user_password_credentials (user_id, password_hash) values ($1, $2)`, [row.id, row.password_hash]);
      await client.query(`delete from auth_pending_registrations where user_id = $1`, [row.id]);
      await client.query("commit");
      return { id: UserId(row.id), username: row.username, passwordHash: row.password_hash };
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally { client.release(); }
  }

  async findUserByEmail(emailHash: Buffer): Promise<{ readonly id: UserIdType; readonly username: string } | null> {
    const result = await this.pool.query<{ id: string; username: string }>(`select u.id, u.username from users u join user_identities i on i.user_id = u.id where i.provider = 'email_corp' and i.identifier_hash = $1 and u.status = 'active'`, [emailHash]);
    const row = result.rows[0];
    return row === undefined ? null : { id: UserId(row.id), username: row.username };
  }

  async replacePassword(userId: UserIdType, passwordHash: string): Promise<void> {
    await this.pool.query(`insert into user_password_credentials (user_id, password_hash) values ($1, $2) on conflict (user_id) do update set password_hash = excluded.password_hash, updated_at = now()`, [userId, passwordHash]);
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

  async findPasswordCredentialByEmail(emailHash: Buffer): Promise<PasswordCredentialUser | null> {
    const result = await this.pool.query<{ id: string; username: string; password_hash: string }>(
      `select u.id, u.username, credentials.password_hash from users u
       join user_identities identities on identities.user_id = u.id
       join user_password_credentials credentials on credentials.user_id = u.id
       where identities.provider = 'email_corp' and identities.identifier_hash = $1 and u.status = 'active'`,
      [emailHash],
    );
    const row = result.rows[0];
    return row === undefined ? null : { id: UserId(row.id), username: row.username, passwordHash: row.password_hash };
  }

  async upsertBootstrapAdmin(username: string, passwordHash: string, updatePassword: boolean): Promise<UserIdType> {
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
      const activeSanction = this.sanctions ? await this.sanctions.findActiveForUserTx(client, UserId(claimed.id)) : null;
      await activateBootstrapAdminUser(client, claimed.id, activeSanction !== null);

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
      return UserId(claimed.id);
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }
}
