import { BadRequestException, HttpException, HttpStatus, Inject, Injectable, InternalServerErrorException, UnauthorizedException } from "@nestjs/common";
import { randomInt } from "node:crypto";
import { jwtVerify } from "jose";
import { UserId, type UserId as UserIdType } from "../../_kernel/brandedIds.ts";
import { ANALYTICS_PORT, type AnalyticsPort } from "../../analytics/public/index.ts";
import { PROFILE_AUTH_PORT, type ProfileAuthPort } from "../../profile/public/index.ts";
import { RuntimeLogger } from "../../../nest/observability/runtime-logger.ts";
import { EMAIL_DOMAINS, type AuthenticatedUser, type EmailDomain, type PlagIdClaims } from "../domain/auth.ts";
import { encryptIdentity, identifierHash } from "../infrastructure/auth-crypto.ts";
import { AuthRepository } from "../infrastructure/auth.repository.ts";
import { OtpEmailAdapter } from "../infrastructure/email.adapter.ts";
import { IdentityStorageAdapter } from "../infrastructure/identity-storage.adapter.ts";
import { verifyPassword } from "../infrastructure/password-hash.ts";

const LOCAL_PART_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const OTP_TTL_MS = 10 * 60 * 1000;
const RESEND_COOLDOWN_MS = 60 * 1000;
const MAX_ATTEMPTS = 5;
const DUMMY_PASSWORD_HASH = "scrypt$32768$8$1$EREREREREREREREREREREQ$tky9M9JZ7spc_B4Lg88Rf_OlbLDRkMFJAy0grGIhDmzWaCRUn6ubG-QseT7Q70-y476KLnZ_pq6MTEO4ZPtiIA";

export interface LoginResult {
  readonly user: AuthenticatedUser;
  readonly created: boolean;
}

function isEmailDomain(value: unknown): value is EmailDomain {
  return typeof value === "string" && (EMAIL_DOMAINS as readonly string[]).includes(value);
}

function normalizeLocalPart(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function validateEmail(localPartValue: unknown, domainValue: unknown): { localPart: string; domain: EmailDomain; email: string } {
  const localPart = normalizeLocalPart(localPartValue);
  if (!LOCAL_PART_RE.test(localPart)) throw new BadRequestException("invalid local part");
  if (!isEmailDomain(domainValue)) throw new BadRequestException("domain not allowed");
  return { localPart, domain: domainValue, email: `${localPart}@${domainValue}` };
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
  ) {}

  private audit(provider: "email_corp" | "plag_id" | "sber_id" | "password" | "dev_bypass", outcome: "success" | "failure", reason?: string): void {
    this.logger.info({ event: "auth.login_attempt", provider, outcome, reason }, "Auth attempt");
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
    const code = randomInt(0, 1_000_000).toString().padStart(6, "0");
    await this.repository.createOtp(emailHash, identifierHash(`${parsed.email}:${code}`), new Date(Date.now() + OTP_TTL_MS));
    await this.email.send(parsed.email, code);
  }

  async verifyEmail(localPartValue: unknown, domainValue: unknown, codeValue: unknown, anonId: string): Promise<LoginResult> {
    const parsed = validateEmail(localPartValue, domainValue);
    const code = typeof codeValue === "string" ? codeValue.trim() : "";
    if (!/^\d{6}$/.test(code)) {
      this.audit("email_corp", "failure", "invalid_code_format");
      throw new BadRequestException("invalid code");
    }
    const emailHash = identifierHash(parsed.email);
    const otp = await this.repository.latestOtp(emailHash);
    if (otp === null || new Date(otp.expires_at).getTime() < Date.now()) {
      this.audit("email_corp", "failure", "code_expired_or_missing");
      throw new UnauthorizedException();
    }
    if (otp.attempts >= MAX_ATTEMPTS) {
      this.audit("email_corp", "failure", "too_many_attempts");
      throw new HttpException("too many attempts", HttpStatus.TOO_MANY_REQUESTS);
    }
    if (!otp.otp_hash.equals(identifierHash(`${parsed.email}:${code}`))) {
      await this.repository.incrementOtpAttempts(otp.id);
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
    const credential = username === "" ? null : await this.repository.findPasswordCredential(username);
    const passwordMatches = await verifyPassword(password, credential?.passwordHash ?? DUMMY_PASSWORD_HASH);
    if (credential === null || !passwordMatches) {
      this.audit("password", "failure", "invalid_credentials");
      throw new UnauthorizedException();
    }
    this.audit("password", "success");
    return { id: credential.id, username: credential.username };
  }

  auditFailure(provider: "plag_id" | "sber_id", reason: string): void {
    this.audit(provider, "failure", reason);
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
