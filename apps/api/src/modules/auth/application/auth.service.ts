import { BadRequestException, HttpException, HttpStatus, Inject, Injectable, InternalServerErrorException, UnauthorizedException } from "@nestjs/common";
import { randomInt, randomUUID } from "node:crypto";
import { Optional } from "@nestjs/common";
import { AUDIT_LOG_PORT, type AuditLogPort } from "../../audit/public/index.ts";
import { jwtVerify } from "jose";
import { UserId, type UserId as UserIdType } from "../../_kernel/brandedIds.ts";
import { ANALYTICS_PORT, type AnalyticsPort } from "../../analytics/public/index.ts";
import { PROFILE_AUTH_PORT, type ProfileAuthPort } from "../../profile/public/index.ts";
import { RuntimeLogger } from "../../../nest/observability/runtime-logger.ts";
import { isAllowedEmailDomain, type AuthenticatedUser, type EmailDomain, type PlagIdClaims } from "../domain/auth.ts";
import { encryptIdentity, identifierHash } from "../infrastructure/auth-crypto.ts";
import { AuthRepository } from "../infrastructure/auth.repository.ts";
import { OtpEmailAdapter } from "../infrastructure/email.adapter.ts";
import { IdentityStorageAdapter } from "../infrastructure/identity-storage.adapter.ts";
import { hashPassword, verifyPassword } from "../infrastructure/password-hash.ts";
import { AUTH_ERRORS } from "../domain/auth-errors.ts";
import { createAuthError } from "../domain/auth-error.helper.ts";

const LOCAL_PART_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const OTP_TTL_MS = 10 * 60 * 1000;
const RESEND_COOLDOWN_MS = 60 * 1000;
const OTP_LENGTH = 4;
const MAX_ATTEMPTS = 3;
const OTP_ATTEMPT_WINDOW_MS = 30 * 60 * 1000;
const OTP_BLOCK_MS = 60 * 60 * 1000;
const DUMMY_PASSWORD_HASH = "scrypt$32768$8$1$EREREREREREREREREREREQ$tky9M9JZ7spc_B4Lg88Rf_OlbLDRkMFJAy0grGIhDmzWaCRUn6ubG-QseT7Q70-y476KLnZ_pq6MTEO4ZPtiIA";

export interface LoginResult {
  readonly user: AuthenticatedUser;
  readonly created: boolean;
}

function normalizeLocalPart(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function validateEmail(localPartValue: unknown, domainValue: unknown): { localPart: string; domain: EmailDomain; email: string } {
  const localPart = normalizeLocalPart(localPartValue);
  if (!LOCAL_PART_RE.test(localPart)) throw new BadRequestException("invalid local part");
  if (!isAllowedEmailDomain(domainValue)) {
    throw createAuthError(AUTH_ERRORS.EMAIL_NOT_SUPPORTED, "Поддерживаются адреса с доменами .ru и .рф.", false);
  }
  const domain = domainValue.trim().toLowerCase();
  return { localPart, domain, email: `${localPart}@${domain}` };
}

function parseEmail(value: unknown): ReturnType<typeof validateEmail> {
  if (typeof value !== "string") throw new BadRequestException("invalid email");
  const at = value.trim().lastIndexOf("@");
  if (at <= 0) throw new BadRequestException("invalid email");
  return validateEmail(value.slice(0, at), value.slice(at + 1));
}

function validPassword(value: unknown): value is string {
  return typeof value === "string" && value.length >= 12 && value.length <= 20;
}

function handleFromLocalPart(localPart: string): string {
  return localPart.replace(/[^a-z0-9.]/g, "").slice(0, 32) || `user${Date.now()}`;
}

function handleFromTelegram(username: string | null, telegramId: number): string {
  const cleaned = (username ?? "").toLowerCase().replace(/[^a-z0-9.]/g, "");
  return (cleaned || `user${telegramId}`).slice(0, 32);
}

@Injectable()
export class AuthService {
  constructor(
    @Inject(AuthRepository) private readonly repository: AuthRepository,
    @Inject(PROFILE_AUTH_PORT) private readonly profiles: ProfileAuthPort,
    @Inject(ANALYTICS_PORT) private readonly analytics: AnalyticsPort,
    @Inject(OtpEmailAdapter) private readonly email: OtpEmailAdapter,
    @Inject(IdentityStorageAdapter) private readonly storage: IdentityStorageAdapter,
    @Inject(RuntimeLogger) private readonly logger: RuntimeLogger,
    @Optional() @Inject(AUDIT_LOG_PORT) private readonly auditLog?: AuditLogPort,
  ) {}

  private audit(provider: "email_corp" | "plag_id" | "sber_id" | "password" | "dev_bypass", outcome: "success" | "failure", reason?: string): void {
    this.logger.info({ event: "auth.login_attempt", provider, outcome, reason }, "Auth attempt");
    if (outcome === "failure") void this.auditLog?.record({ schema_version: 1, id: randomUUID(), actor_user_id: null, actor_type: "system", subject_type: "login_attempt", subject_id: randomUUID(), action: "auth.login.failed", before_state: null, after_state: { provider, outcome }, reason: reason ?? null, correlation_id: randomUUID(), causation_id: null, idempotency_key: `auth.failed:${provider}:${randomUUID()}`, occurred_at: new Date(), legal_hold: false });
  }

  async startEmail(localPartValue: unknown, domainValue: unknown): Promise<void> {
    let parsed: ReturnType<typeof validateEmail>;
    try {
      parsed = validateEmail(localPartValue, domainValue);
    } catch (error) {
      this.audit("email_corp", "failure", normalizeLocalPart(localPartValue) === "" ? "invalid_local_part" : "domain_or_local_part_invalid");
      throw error;
    }
    const emailHash = identifierHash(parsed.email);
    const latest = await this.repository.latestOtpCreatedAt(emailHash);
    if (latest !== null && Date.now() - latest.getTime() < RESEND_COOLDOWN_MS) {
      this.audit("email_corp", "failure", "rate_limited");
      throw new HttpException("too many requests", HttpStatus.TOO_MANY_REQUESTS);
    }
    const code = randomInt(0, 10 ** OTP_LENGTH).toString().padStart(OTP_LENGTH, "0");
    await this.repository.createOtp(emailHash, identifierHash(`${parsed.email}:${code}`), new Date(Date.now() + OTP_TTL_MS));
    await this.email.send(parsed.email, code);
  }

  async verifyEmail(localPartValue: unknown, domainValue: unknown, codeValue: unknown, anonId: string): Promise<LoginResult> {
    const parsed = validateEmail(localPartValue, domainValue);
    const code = typeof codeValue === "string" ? codeValue.trim() : "";
    if (!new RegExp(`^\\d{${OTP_LENGTH}}$`).test(code)) {
      this.audit("email_corp", "failure", "invalid_code_format");
      throw new BadRequestException("invalid code");
    }
    const emailHash = identifierHash(parsed.email);
    const otp = await this.repository.latestOtp(emailHash);
    if (otp === null || new Date(otp.expires_at).getTime() < Date.now()) {
      this.audit("email_corp", "failure", "code_expired_or_missing");
      throw new UnauthorizedException();
    }
    if (otp.block_until !== null && new Date(otp.block_until).getTime() > Date.now()) {
      this.audit("email_corp", "failure", "blocked");
      throw new HttpException({ code: "auth.code_blocked.v1", message: "Слишком много попыток. Повторите позже.", retryAt: new Date(otp.block_until).toISOString() }, HttpStatus.TOO_MANY_REQUESTS);
    }
    if (new Date(otp.created_at).getTime() + OTP_ATTEMPT_WINDOW_MS < Date.now()) {
      this.audit("email_corp", "failure", "attempt_window_expired");
      throw new UnauthorizedException();
    }
    if (otp.attempts >= MAX_ATTEMPTS) {
      this.audit("email_corp", "failure", "too_many_attempts");
      throw new HttpException("too many attempts", HttpStatus.TOO_MANY_REQUESTS);
    }
    if (!otp.otp_hash.equals(identifierHash(`${parsed.email}:${code}`))) {
      const attempts = otp.attempts + 1;
      await this.repository.incrementOtpAttempts(otp.id, attempts >= MAX_ATTEMPTS ? new Date(Date.now() + OTP_BLOCK_MS) : null);
      this.audit("email_corp", "failure", "wrong_code");
      throw new UnauthorizedException();
    }
    await this.repository.consumeOtp(otp.id);

    const existing = await this.repository.findIdentity("email_corp", emailHash);
    const userId =
      existing ??
      (await this.profiles.createUserWithFreeHandle({
        handle: handleFromLocalPart(parsed.localPart),
        displayName: null,
        avatarUrl: null,
      }));
    const created = existing === null;
    if (created) {
      await this.persistIdentity(userId, "email_corp", parsed.email, emailHash, { email: parsed.email, domain: parsed.domain });
      await this.analytics.emitEvent({ eventName: "signup", anonId, userId, props: { provider: "email_corp" } });
    }
    const user = await this.sessionUser(userId);
    this.audit("email_corp", "success");
    return { user, created };
  }

  async registerWithPassword(input: { readonly email?: unknown; readonly password?: unknown; readonly displayName?: unknown; readonly gender?: unknown; readonly birthYear?: unknown }): Promise<void> {    
    const parsed = parseEmail(input.email);    
    if (!validPassword(input.password)) {
      throw new BadRequestException("password must contain 12 to 20 characters");
    }    
    const displayName = typeof input.displayName === "string" ? input.displayName.trim().slice(0, 64) : "";

    if (displayName === "") {
      throw new BadRequestException("display name is required");
    }
    
    const gender = typeof input.gender === "string" && input.gender.trim() !== "" ? input.gender.trim().slice(0, 32) : null;
    const birthYear = typeof input.birthYear === "number" && Number.isInteger(input.birthYear) && input.birthYear >= 1900 && input.birthYear <= new Date().getFullYear() ? input.birthYear : null;
    
    const emailHash = identifierHash(parsed.email);
    
    const created = await this.repository.createPendingRegistration({
      emailHash,
      identityKey: `identities/pending/${emailHash.toString("hex")}.json.enc`,
      handle: handleFromLocalPart(parsed.localPart),
      displayName,
      gender,
      birthYear,
      passwordHash: await hashPassword(input.password),
    });
    
    const hasPending = created || await this.repository.hasPendingRegistration(emailHash);
    
    if (hasPending) {
      await this.issueOtp(parsed.email, emailHash);
    }
  }

  async activateWithCode(emailValue: unknown, codeValue: unknown): Promise<AuthenticatedUser> {
    const parsed = parseEmail(emailValue);
    const emailHash = identifierHash(parsed.email);
    await this.verifyOtp(parsed.email, emailHash, codeValue);
    const credential = await this.repository.activatePendingRegistration(emailHash);
    if (credential === null) throw new UnauthorizedException();
    return { id: credential.id, username: credential.username };
  }

  async startRecovery(emailValue: unknown): Promise<void> {
    let parsed: ReturnType<typeof parseEmail>;
    try { parsed = parseEmail(emailValue); } catch { return; }
    const emailHash = identifierHash(parsed.email);
    if (await this.repository.findUserByEmail(emailHash)) await this.issueOtp(parsed.email, emailHash);
  }

  async recoverPassword(emailValue: unknown, codeValue: unknown, passwordValue: unknown): Promise<void> {
    if (!validPassword(passwordValue)) throw new BadRequestException("password must contain 12 to 20 characters");
    const parsed = parseEmail(emailValue);
    const emailHash = identifierHash(parsed.email);
    await this.verifyOtp(parsed.email, emailHash, codeValue);
    const user = await this.repository.findUserByEmail(emailHash);
    if (user === null) throw new UnauthorizedException();
    await this.repository.replacePassword(user.id, await hashPassword(passwordValue));
    await this.profiles.bumpSessionVersion(user.id);
  }

  async loginPlagId(token: string, secret: string, anonId: string): Promise<LoginResult> {
    let claims: PlagIdClaims;
    try {
      const verified = await jwtVerify(token, new TextEncoder().encode(secret));
      claims = verified.payload as unknown as PlagIdClaims;
      if (typeof claims.telegramId !== "number" || typeof claims.firstName !== "string") throw new Error("invalid claims");
    } catch {
      this.audit("plag_id", "failure", "invalid_or_expired_token");
      throw new UnauthorizedException();
    }
    const hash = identifierHash(String(claims.telegramId));
    const existing = await this.repository.findIdentity("plag_id", hash);
    const userId =
      existing ??
      (await this.profiles.createUserWithFreeHandle({
        handle: handleFromTelegram(claims.username, claims.telegramId),
        displayName: [claims.firstName, claims.lastName].filter(Boolean).join(" ") || null,
        avatarUrl: claims.photoUrl,
      }));
    const created = existing === null;
    if (created) {
      await this.persistIdentity(userId, "plag_id", String(claims.telegramId), hash, claims as unknown as Record<string, unknown>);
      await this.analytics.emitEvent({ eventName: "signup", anonId, userId, props: { provider: "plag_id" } });
    }
    const user = await this.sessionUser(userId);
    this.audit("plag_id", "success");
    return { user, created };
  }

  async devLogin(): Promise<AuthenticatedUser | null> {
    const profile = await this.profiles.upsertDevUser();
    if (profile === null) {
      this.audit("dev_bypass", "failure", "user_unavailable");
      return null;
    }
    this.audit("dev_bypass", "success");
    return { id: profile.id, username: profile.username };
  }

  async loginPassword(usernameValue: unknown, passwordValue: unknown): Promise<AuthenticatedUser> {
    const username = typeof usernameValue === "string" ? usernameValue.trim().toLowerCase() : "";
    const password = typeof passwordValue === "string" && passwordValue.length <= 1024 ? passwordValue : "";
    const credential = username.includes("@")
      ? await this.repository.findPasswordCredentialByEmail(identifierHash(username))
      : username ? await this.repository.findPasswordCredential(username) : null;
    const passwordMatches = await verifyPassword(password, credential?.passwordHash ?? DUMMY_PASSWORD_HASH);
    if (credential === null || !passwordMatches) {
      this.audit("password", "failure", "invalid_credentials");
      throw new UnauthorizedException();
    }
    this.audit("password", "success");
    return { id: credential.id, username: credential.username };
  }

  async listSessions(userId: UserIdType, currentSessionId: string | undefined): Promise<readonly { readonly id: string; readonly created_at: Date | string; readonly isCurrent: boolean }[]> {
    const rows = await this.repository.getSessionsByUserId(userId);
    return rows.map((row) => ({ id: row.id, created_at: row.created_at, isCurrent: row.id === currentSessionId }));
  }

  async deleteSession(userId: UserIdType, sessionId: string): Promise<void> {
    const target = await this.repository.getSessionById(sessionId);
    if (target === null) throw createAuthError(AUTH_ERRORS.SESSION_NOT_FOUND, "Сеанс не найден.", false, HttpStatus.NOT_FOUND);
    if (target.user_id !== userId) throw createAuthError(AUTH_ERRORS.FORBIDDEN, "Нет доступа к этому сеансу.", false, HttpStatus.FORBIDDEN);
    await this.repository.deleteSessionById(sessionId);
  }

  async deleteOtherSessions(userId: UserIdType, currentSessionId: string | undefined): Promise<void> {
    await this.repository.deleteAllSessionsByUserId(userId, currentSessionId);
  }

  auditFailure(provider: "plag_id" | "sber_id", reason: string): void {
    this.audit(provider, "failure", reason);
  }

  private async issueOtp(email: string, emailHash: Buffer): Promise<void> {
    const latest = await this.repository.latestOtpCreatedAt(emailHash);
    if (latest !== null && Date.now() - latest.getTime() < RESEND_COOLDOWN_MS) return;
    const code = randomInt(0, 10 ** OTP_LENGTH).toString().padStart(OTP_LENGTH, "0");
    console.log("DEV OTP CODE:", code);

    await this.repository.createOtp(emailHash, identifierHash(`${email}:${code}`), new Date(Date.now() + OTP_TTL_MS));
    await this.email.send(email, code);
  }

  private async verifyOtp(email: string, emailHash: Buffer, codeValue: unknown): Promise<void> {
    const code = typeof codeValue === "string" ? codeValue.trim() : "";
    if (!new RegExp(`^\\d{${OTP_LENGTH}}$`).test(code)) {
      throw createAuthError(AUTH_ERRORS.INVALID_CODE, "Неверный код.", false);
    }
    const otp = await this.repository.latestOtp(emailHash);
    if (otp === null || new Date(otp.expires_at).getTime() < Date.now()) {
      throw createAuthError(AUTH_ERRORS.CODE_EXPIRED, "Код неверный или истёк.", false, HttpStatus.UNAUTHORIZED);
    }
    if (otp.block_until !== null && new Date(otp.block_until).getTime() > Date.now()) {
      throw createAuthError(AUTH_ERRORS.ACCOUNT_BLOCKED, "Слишком много попыток. Повторите позже.", true, HttpStatus.TOO_MANY_REQUESTS);
    }
    if (new Date(otp.created_at).getTime() + OTP_ATTEMPT_WINDOW_MS < Date.now() || otp.attempts >= MAX_ATTEMPTS) {
      throw createAuthError(AUTH_ERRORS.TOO_MANY_ATTEMPTS, "Слишком много попыток. Повторите позже.", true, HttpStatus.TOO_MANY_REQUESTS);
    }
    if (!otp.otp_hash.equals(identifierHash(`${email}:${code}`))) {
      const attempts = otp.attempts + 1;
      await this.repository.incrementOtpAttempts(otp.id, attempts >= MAX_ATTEMPTS ? new Date(Date.now() + OTP_BLOCK_MS) : null);
      throw createAuthError(AUTH_ERRORS.INVALID_CODE, "Неверный код.", true, HttpStatus.UNAUTHORIZED);
    }
    await this.repository.consumeOtp(otp.id);
  }

  private async sessionUser(userId: UserIdType): Promise<AuthenticatedUser> {
    const profile = await this.profiles.findSessionUser(UserId(userId));
    if (profile === null) throw new InternalServerErrorException("user not found after upsert");
    return { id: profile.id, username: profile.username };
  }

  private async persistIdentity(
    userId: UserIdType,
    provider: "email_corp" | "plag_id",
    identifier: string,
    hash: Buffer,
    rawClaims: Readonly<Record<string, unknown>>,
  ): Promise<void> {
    const key = `identities/${userId}/${provider}.json.enc`;
    await this.storage.put(
      key,
      encryptIdentity({
        provider,
        identifier,
        raw_claims: rawClaims,
        verified_at: new Date().toISOString(),
      }),
    );
    await this.repository.createIdentity(userId, provider, hash, key);
  }
}
