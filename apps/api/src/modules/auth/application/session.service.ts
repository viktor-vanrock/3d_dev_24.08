import { Inject, Injectable, Optional, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Response } from "express";
import { SignJWT } from "jose";
import { createHash, randomUUID } from "node:crypto";
import { PROFILE_AUTH_PORT, type ProfileAuthPort } from "../../profile/public/index.ts";
import { RuntimeLogger } from "../../../nest/observability/runtime-logger.ts";
import { SESSION_COOKIE_NAME, type AuthenticatedUser } from "../domain/auth.ts";
import { AuthRepository } from "../infrastructure/auth.repository.ts";

const THIRTY_DAYS_SECONDS = 30 * 24 * 60 * 60;

@Injectable()
export class AuthSessionService {
  constructor(
    @Inject(ConfigService) private readonly config: ConfigService,
    @Inject(PROFILE_AUTH_PORT) private readonly profiles: ProfileAuthPort,
    @Inject(RuntimeLogger) private readonly logger: RuntimeLogger,
    @Optional() @Inject(AuthRepository) private readonly repository?: AuthRepository,
  ) {}

  private cookieDomain(): string | undefined {
    const configuredDomain = this.config.get<string>("COOKIE_DOMAIN")?.trim();
    if (configuredDomain) return configuredDomain;
    return this.config.get<string>("NODE_ENV") === "production" ? ".3mf.tech" : undefined;
  }

  private secret(): Uint8Array {
    const value = this.config.get<string>("JWT_SECRET");
    if (value === undefined || value === "") throw new Error("JWT_SECRET не задан");
    return new TextEncoder().encode(value);
  }

  async createToken(user: AuthenticatedUser): Promise<string> {
    const state = await this.profiles.loadOwnerAuthState(user.id);
    if (state === null) {
      this.logger.warn({ event: "auth.session.issue_denied", credentialType: "session", reason: "unknown" }, "Session issue denied");
      throw new UnauthorizedException("auth.session.issue_denied.v1");
    }
    if (state.status !== "active") {
      this.logger.warn({ event: "auth.session.issue_denied", credentialType: "session", reason: "user_blocked" }, "Session issue denied");
      throw new UnauthorizedException("auth.session.issue_denied.v1");
    }

    const sessionId = randomUUID();
    const token = await new SignJWT({ username: user.username, sv: state.sessionVersion, sid: sessionId })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(user.id)
      .setIssuedAt()
      .setExpirationTime(`${THIRTY_DAYS_SECONDS}s`)
      .sign(this.secret());
    await this.repository?.createSession(user.id, createHash("sha256").update(token).digest("hex"), sessionId);
    return token;
  }

  async issue(response: Response, user: AuthenticatedUser): Promise<void> {
    const domain = this.cookieDomain();
    response.cookie(SESSION_COOKIE_NAME, await this.createToken(user), {
      ...(domain === undefined ? {} : { domain }),
      path: "/",
      httpOnly: true,
      secure: this.config.get<string>("NODE_ENV") === "production",
      sameSite: "lax",
      maxAge: THIRTY_DAYS_SECONDS * 1000,
    });
  }

  async logoutAll(userId: AuthenticatedUser["id"]): Promise<void> {
    if (!(await this.profiles.bumpSessionVersion(userId))) throw new UnauthorizedException("auth.session.issue_denied.v1");
    this.logger.info({ event: "auth.logout_all", credentialType: "session" }, "All sessions logged out");
  }

  async logout(userId: AuthenticatedUser["id"]): Promise<void> {
    if (!(await this.profiles.bumpSessionVersion(userId))) throw new UnauthorizedException("auth.session.issue_denied.v1");
    this.logger.info({ event: "auth.logout", credentialType: "session" }, "Session logged out");
  }

  clear(response: Response): void {
    const domain = this.cookieDomain();
    response.clearCookie(SESSION_COOKIE_NAME, {
      ...(domain === undefined ? {} : { domain }),
      path: "/",
    });
  }
}
