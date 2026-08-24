import { Global, Inject, Injectable, Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { APP_FILTER, APP_INTERCEPTOR, APP_PIPE } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { SignJWT } from "jose";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { UserId, type UserId as UserIdType } from "../../_kernel/brandedIds.ts";
import { ANALYTICS_PORT } from "../../analytics/public/index.ts";
import { PROFILE_AUTH_PORT, type NewUserSeed, type ProfileAuthPort, type SessionProfile } from "../../profile/public/index.ts";
import { createNestApp } from "../../../nest/bootstrap.ts";
import { SessionVerifierModule } from "../../../nest/auth/session-verifier.module.ts";
import { DATABASE_POOL } from "../../../nest/database/database.constants.ts";
import { DatabaseModule } from "../../../nest/database/database.module.ts";
import { ApiExceptionFilter } from "../../../nest/errors/api-exception.filter.ts";
import { CorrelationInterceptor } from "../../../nest/observability/correlation.interceptor.ts";
import { RequestContext } from "../../../nest/observability/request-context.ts";
import { RuntimeLogger } from "../../../nest/observability/runtime-logger.ts";
import { createApiValidationPipe } from "../../../nest/validation/api-validation.pipe.ts";
import { AuthModule } from "../auth.module.ts";
import { identifierHash } from "../infrastructure/auth-crypto.ts";
import { AuthRepository } from "../infrastructure/auth.repository.ts";
import { hashPassword, verifyPassword } from "../infrastructure/password-hash.ts";

@Injectable()
class TestProfileAuthPort implements ProfileAuthPort {
  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {}

  async findSessionUser(userId: UserIdType): Promise<SessionProfile | null> {
    const result = await this.pool.query<{
      id: string;
      username: string;
      display_name: string | null;
      avatar_url: string | null;
      handle_confirmed: boolean;
      role: "user" | "researcher";
    }>(
      `select id, username, display_name, avatar_url, handle_confirmed, role
       from users where id = $1 and status = 'active'`,
      [userId],
    );
    const row = result.rows[0];
    return row === undefined
      ? null
      : {
          id: UserId(row.id),
          username: row.username,
          displayName: row.display_name,
          avatarUrl: row.avatar_url,
          handleConfirmed: row.handle_confirmed,
          role: row.role,
      };
  }

  async loadOwnerAuthState(userId: UserIdType): Promise<{ readonly status: "active" | "banned" | "deleted"; readonly sessionVersion: number } | null> {
    const result = await this.pool.query<{ status: "active" | "banned" | "deleted" }>(`select status from users where id = $1`, [userId]);
    const row = result.rows[0];
    return row === undefined ? null : { status: row.status, sessionVersion: 1 };
  }

  async bumpSessionVersion(userId: UserIdType): Promise<boolean> {
    return (await this.pool.query(`select 1 from users where id = $1`, [userId])).rowCount !== 0;
  }

  async createUserWithFreeHandle(seed: NewUserSeed): Promise<UserIdType> {
    const result = await this.pool.query<{ id: string }>(`insert into users (username, display_name, avatar_url) values ($1, $2, $3) returning id`, [
      seed.handle,
      seed.displayName,
      seed.avatarUrl,
    ]);
    return UserId(result.rows[0]!.id);
  }

  async upsertDevUser(): Promise<SessionProfile | null> {
    const result = await this.pool.query<{ id: string }>(
      `insert into users (username, display_name, handle_confirmed)
       values ('devuser', 'DEV Reviewer', true)
       on conflict (username) do update set display_name = excluded.display_name
       returning id`,
    );
    return this.findSessionUser(UserId(result.rows[0]!.id));
  }
}

@Global()
@Module({
  imports: [DatabaseModule],
  providers: [
    TestProfileAuthPort,
    { provide: PROFILE_AUTH_PORT, useExisting: TestProfileAuthPort },
    { provide: ANALYTICS_PORT, useValue: { emitEvent: (): Promise<void> => Promise.resolve() } },
  ],
  exports: [PROFILE_AUTH_PORT, ANALYTICS_PORT],
})
class AuthTestPortsModule {}

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }), SessionVerifierModule, DatabaseModule, AuthTestPortsModule, AuthModule],
  providers: [
    RequestContext,
    RuntimeLogger,
    { provide: APP_INTERCEPTOR, useClass: CorrelationInterceptor },
    { provide: APP_FILTER, useClass: ApiExceptionFilter },
    { provide: APP_PIPE, useFactory: createApiValidationPipe },
  ],
})
class AuthTestModule {}

const JWT_SECRET = "nest-auth-domain-test-secret";
const HMAC_KEY = "nest-auth-hmac-test-secret";
const ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
let app: NestExpressApplication;
let baseUrl: string;
const originalEnvironment = {
  JWT_SECRET: process.env.JWT_SECRET,
  AUTH_HMAC_KEY: process.env.AUTH_HMAC_KEY,
  AUTH_ENCRYPTION_KEY: process.env.AUTH_ENCRYPTION_KEY,
  AUTH_DEV_BYPASS: process.env.AUTH_DEV_BYPASS,
  NODE_ENV: process.env.NODE_ENV,
};

function restoreEnvironment(name: keyof typeof originalEnvironment): void {
  const value = originalEnvironment[name];
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

describe("Nest auth domain migration", () => {
  beforeAll(async () => {
    process.env.JWT_SECRET = JWT_SECRET;
    process.env.AUTH_HMAC_KEY = HMAC_KEY;
    process.env.AUTH_ENCRYPTION_KEY = ENCRYPTION_KEY;
    process.env.NODE_ENV = "test";
    delete process.env.AUTH_DEV_BYPASS;
    app = await createNestApp(AuthTestModule);
    await app.listen(0, "127.0.0.1");
    const address = (app.getHttpServer() as { address(): string | { port: number } | null }).address();
    if (address === null || typeof address === "string") throw new Error("Nest auth test server did not bind");
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await app?.close();
    restoreEnvironment("JWT_SECRET");
    restoreEnvironment("AUTH_HMAC_KEY");
    restoreEnvironment("AUTH_ENCRYPTION_KEY");
    restoreEnvironment("AUTH_DEV_BYPASS");
    restoreEnvironment("NODE_ENV");
  });

  it("uses the versioned unauthorized envelope for an absent session", async () => {
    const response = await fetch(`${baseUrl}/auth/session`);
    expect(response.status).toBe(401);
    const body = (await response.json()) as { error: { code: string; requestId: string } };
    expect(body.error.code).toBe("auth.unauthorized.v1");
    expect(body.error.requestId).toBe(response.headers.get("x-request-id"));
  });

  it("preserves logout status and clears the production-shaped session cookie", async () => {
    const response = await fetch(`${baseUrl}/auth/logout`, { method: "POST" });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
    expect(response.headers.get("set-cookie")).toContain("portal_session=");
  });

  it("preserves PlagID redirects and native-app intent cookie", async () => {
    const start = await fetch(`${baseUrl}/auth/plagid/start?app=1`, { redirect: "manual" });
    expect(start.status).toBe(302);
    expect(start.headers.get("location")).toContain("https://auth.plag.space/login?redirect=");
    expect(start.headers.get("set-cookie")).toContain("plagid_app=1");

    const callback = await fetch(`${baseUrl}/auth/plagid/callback?reason=access_denied`, {
      headers: { cookie: "plagid_app=1" },
      redirect: "manual",
    });
    expect(callback.status).toBe(302);
    expect(callback.headers.get("location")).toBe("ultradevice://auth?error=access_denied");
  });

  it("preserves PlagID invalid-token 401 with the versioned auth envelope", async () => {
    const originalSecret = process.env.PLAGID_EXTERNAL_TOKEN_SECRET;
    process.env.PLAGID_EXTERNAL_TOKEN_SECRET = "plagid-test-secret";
    try {
      const response = await fetch(`${baseUrl}/auth/plagid/callback?token=not-a-jwt`);
      expect(response.status).toBe(401);
      await expect(response.json()).resolves.toMatchObject({ error: { code: "auth.unauthorized.v1" } });
    } finally {
      if (originalSecret === undefined) delete process.env.PLAGID_EXTERNAL_TOKEN_SECRET;
      else process.env.PLAGID_EXTERNAL_TOKEN_SECRET = originalSecret;
    }
  });

  it.each(["start", "callback"])("keeps SberID %s at 501 with the versioned error envelope", async (route) => {
    const response = await fetch(`${baseUrl}/auth/sberid/${route}`);
    expect(response.status).toBe(501);
    const body = (await response.json()) as { error: { code: string; requestId: string } };
    expect(body.error.code).toBe("auth.sberid_not_implemented.v1");
    expect(body.error.requestId).toBe(response.headers.get("x-request-id"));
  });

  it("keeps the dev bypass invisible unless both safety conditions pass", async () => {
    const response = await fetch(`${baseUrl}/auth/dev`, { method: "POST" });
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "http.not_found.v1" } });
  });

  it("issues the idempotent developer session only when the non-production bypass is explicit", async () => {
    process.env.NODE_ENV = "development";
    process.env.AUTH_DEV_BYPASS = "true";
    const database = app.get<Pool>(DATABASE_POOL);
    try {
      const first = await fetch(`${baseUrl}/auth/dev`, { method: "POST" });
      const second = await fetch(`${baseUrl}/auth/dev`, { method: "POST" });
      expect(first.status).toBe(200);
      expect(second.status).toBe(200);
      const firstBody = (await first.json()) as { user: { id: string } };
      const secondBody = (await second.json()) as { user: { id: string } };
      expect(firstBody.user.id).toBe(secondBody.user.id);
      expect(first.headers.get("set-cookie")).toContain("portal_session=");
    } finally {
      await database.query(`delete from users where username = 'devuser'`);
      process.env.NODE_ENV = "test";
      delete process.env.AUTH_DEV_BYPASS;
    }
  });

  it("issues a session only for a matching local password credential", async () => {
    const database = app.get<Pool>(DATABASE_POOL);
    const username = `admin.${Date.now()}`;
    const password = "integration-admin-password";
    const passwordHash = await hashPassword(password);
    const user = await database.query<{ id: string }>(`insert into users (username, is_staff) values ($1, true) returning id`, [username]);
    try {
      await database.query(`insert into user_password_credentials (user_id, password_hash) values ($1, $2)`, [user.rows[0]!.id, passwordHash]);

      const denied = await fetch(`${baseUrl}/auth/password`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username, password: "wrong-password" }),
      });
      expect(denied.status).toBe(401);

      const allowed = await fetch(`${baseUrl}/auth/password`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      expect(allowed.status).toBe(200);
      await expect(allowed.json()).resolves.toMatchObject({ ok: true, user: { username } });
      expect(allowed.headers.get("set-cookie")).toContain("portal_session=");
    } finally {
      await database.query(`delete from users where id = $1`, [user.rows[0]!.id]);
    }
  });

  it("refuses to elevate an existing non-bootstrap account", async () => {
    const database = app.get<Pool>(DATABASE_POOL);
    const repository = app.get(AuthRepository);
    const username = `claimed.${Date.now()}`;
    const user = await database.query<{ id: string }>(`insert into users (username, is_staff) values ($1, false) returning id`, [username]);
    try {
      await expect(repository.upsertBootstrapAdmin(username, await hashPassword("admin-password"), false)).rejects.toThrow(
        "ADMIN_USERNAME is already owned by a non-bootstrap account",
      );
      await expect(database.query<{ is_staff: boolean }>(`select is_staff from users where id = $1`, [user.rows[0]!.id])).resolves.toMatchObject({ rows: [{ is_staff: false }] });
    } finally {
      await database.query(`delete from users where id = $1`, [user.rows[0]!.id]);
    }
  });

  it("creates a staff bootstrap account and applies the password refresh policy", async () => {
    const database = app.get<Pool>(DATABASE_POOL);
    const repository = app.get(AuthRepository);
    const username = `bootstrap.${Date.now()}`;
    const initialHash = await hashPassword("initial-admin-password");
    const replacementHash = await hashPassword("replacement-admin-password");
    let userId: string | undefined;
    try {
      await repository.upsertBootstrapAdmin(username, initialHash, false);
      const created = await database.query<{ id: string; is_staff: boolean; password_hash: string }>(
        `select u.id, u.is_staff, credentials.password_hash
         from users u join user_password_credentials credentials on credentials.user_id = u.id
         where u.username = $1`,
        [username],
      );
      userId = created.rows[0]?.id;
      expect(created.rows[0]?.is_staff).toBe(true);
      await expect(verifyPassword("initial-admin-password", created.rows[0]!.password_hash)).resolves.toBe(true);

      await repository.upsertBootstrapAdmin(username, replacementHash, false);
      const preserved = await database.query<{ password_hash: string }>(`select password_hash from user_password_credentials where user_id = $1`, [userId]);
      await expect(verifyPassword("initial-admin-password", preserved.rows[0]!.password_hash)).resolves.toBe(true);

      await repository.upsertBootstrapAdmin(username, replacementHash, true);
      const refreshed = await database.query<{ password_hash: string }>(`select password_hash from user_password_credentials where user_id = $1`, [userId]);
      await expect(verifyPassword("replacement-admin-password", refreshed.rows[0]!.password_hash)).resolves.toBe(true);
    } finally {
      if (userId !== undefined) await database.query(`delete from users where id = $1`, [userId]);
    }
  });

  it("rate-limits repeated password guesses for the same username", async () => {
    const originalLimit = process.env.RATE_LIMIT_AUTH_PASSWORD_USERNAME_PER_MIN;
    process.env.RATE_LIMIT_AUTH_PASSWORD_USERNAME_PER_MIN = "1";
    const username = `missing.${Date.now()}`;
    try {
      const request = () =>
        fetch(`${baseUrl}/auth/password`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ username, password: "wrong-password" }),
        });
      expect((await request()).status).toBe(401);
      expect((await request()).status).toBe(429);
    } finally {
      if (originalLimit === undefined) delete process.env.RATE_LIMIT_AUTH_PASSWORD_USERNAME_PER_MIN;
      else process.env.RATE_LIMIT_AUTH_PASSWORD_USERNAME_PER_MIN = originalLimit;
    }
  });

  it("does not share the password fingerprint bucket across usernames", async () => {
    const originalLimit = process.env.RATE_LIMIT_AUTH_PASSWORD_FINGERPRINT_PER_MIN;
    process.env.RATE_LIMIT_AUTH_PASSWORD_FINGERPRINT_PER_MIN = "1";
    const suffix = Date.now();
    try {
      const request = (username: string) =>
        fetch(`${baseUrl}/auth/password`, {
          method: "POST",
          headers: { "content-type": "application/json", "user-agent": "shared-browser-fingerprint" },
          body: JSON.stringify({ username, password: "wrong-password" }),
        });
      expect((await request(`missing.one.${suffix}`)).status).toBe(401);
      expect((await request(`missing.two.${suffix}`)).status).toBe(401);
    } finally {
      if (originalLimit === undefined) delete process.env.RATE_LIMIT_AUTH_PASSWORD_FINGERPRINT_PER_MIN;
      else process.env.RATE_LIMIT_AUTH_PASSWORD_FINGERPRINT_PER_MIN = originalLimit;
    }
  });

  it("completes a valid PlagID callback, links the identity, and redirects with a session cookie", async () => {
    const database = app.get<Pool>(DATABASE_POOL);
    const secret = "plagid-positive-test-secret";
    const telegramId = Date.now();
    const username = `plag${telegramId}`.slice(0, 32);
    const hash = identifierHash(String(telegramId));
    const token = await new SignJWT({ telegramId, username, firstName: "Test", lastName: null, photoUrl: null })
      .setProtectedHeader({ alg: "HS256" })
      .setExpirationTime("5m")
      .sign(new TextEncoder().encode(secret));
    const originalSecret = process.env.PLAGID_EXTERNAL_TOKEN_SECRET;
    process.env.PLAGID_EXTERNAL_TOKEN_SECRET = secret;
    let userId: string | undefined;
    try {
      const response = await fetch(`${baseUrl}/auth/plagid/callback?token=${encodeURIComponent(token)}`, { redirect: "manual" });
      expect(response.status).toBe(302);
      expect(response.headers.get("location")).toBe("https://3mf.tech");
      expect(response.headers.get("set-cookie")).toContain("portal_session=");
      const identity = await database.query<{ user_id: string }>(`select user_id from user_identities where provider = 'plag_id' and identifier_hash = $1`, [hash]);
      userId = identity.rows[0]?.user_id;
      expect(userId).toBeTruthy();
    } finally {
      if (originalSecret === undefined) delete process.env.PLAGID_EXTERNAL_TOKEN_SECRET;
      else process.env.PLAGID_EXTERNAL_TOKEN_SECRET = originalSecret;
      await database.query(`delete from user_identities where provider = 'plag_id' and identifier_hash = $1`, [hash]);
      if (userId !== undefined) await database.query(`delete from users where id = $1`, [userId]);
    }
  });

  it("preserves email validation statuses and completes a valid OTP login through the profile port", async () => {
    const invalid = await fetch(`${baseUrl}/auth/email/start`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ localPart: "not allowed!", domain: "example.com" }),
    });
    expect(invalid.status).toBe(400);
    await expect(invalid.json()).resolves.toMatchObject({ error: { code: "http.bad_request.v1" } });

    const localPart = `nestauth${Date.now()}`;
    const email = `${localPart}@sberdevices.ru`;
    const code = "123456";
    const emailHash = identifierHash(email);
    const database = app.get<Pool>(DATABASE_POOL);
    await database.query(`insert into email_otp (email_hash, otp_hash, expires_at) values ($1, $2, now() + interval '10 minutes')`, [
      emailHash,
      identifierHash(`${email}:${code}`),
    ]);
    let userId: string | undefined;
    try {
      const response = await fetch(`${baseUrl}/auth/email/verify`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ localPart, domain: "sberdevices.ru", code }),
      });
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({ ok: true });
      expect(response.headers.get("set-cookie")).toContain("portal_session=");
      const identity = await database.query<{ user_id: string }>(`select user_id from user_identities where provider = 'email_corp' and identifier_hash = $1`, [emailHash]);
      userId = identity.rows[0]?.user_id;
      expect(userId).toBeTruthy();

      const token = await new SignJWT({ username: localPart, sv: 1 })
        .setProtectedHeader({ alg: "HS256" })
        .setSubject(userId!)
        .setExpirationTime("5m")
        .sign(new TextEncoder().encode(JWT_SECRET));
      const session = await fetch(`${baseUrl}/auth/session`, { headers: { authorization: `Bearer ${token}` } });
      expect(session.status).toBe(200);
      await expect(session.json()).resolves.toMatchObject({ user: { id: userId, username: localPart } });
    } finally {
      await database.query(`delete from email_otp where email_hash = $1`, [emailHash]);
      await database.query(`delete from user_identities where identifier_hash = $1`, [emailHash]);
      if (userId !== undefined) await database.query(`delete from users where id = $1`, [userId]);
    }
  });
});
