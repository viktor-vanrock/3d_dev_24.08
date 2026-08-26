import { Inject, Injectable, Optional } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { parseCookie } from "cookie";
import type { Request } from "express";
import { jwtVerify } from "jose";
import { UserId } from "../../modules/_kernel/brandedIds.ts";
import { PROFILE_AUTH_PORT, type ProfileAuthPort } from "../../modules/profile/public/index.ts";
import { SANCTIONS_READ_PORT, type SanctionsReadPort } from "../../modules/sanctions/public/index.ts";
import { AccountRestrictedException } from "./account-restricted.exception.ts";
import { RuntimeLogger } from "../observability/runtime-logger.ts";
import { MetricsService } from "../observability/metrics.service.ts";

export const SESSION_COOKIE_NAME = "portal_session";
export const SESSION_USER = Symbol("SESSION_USER");

export interface SessionUser {
  readonly id: string;
  readonly username: string;
  readonly sessionVersion: number;
}

export interface RequestWithSession extends Request {
  [SESSION_USER]?: SessionUser;
}

function sessionToken(request: Request): string | undefined {
  const cookieHeader = request.headers.cookie;
  if (cookieHeader !== undefined) {
    const cookieToken = parseCookie(cookieHeader)[SESSION_COOKIE_NAME];
    if (cookieToken !== undefined && cookieToken !== "") return cookieToken;
  }

  const authorization = request.headers.authorization;
  if (authorization === undefined) return undefined;
  return /^Bearer (\S+)$/.exec(authorization)?.[1];
}

interface SessionClaims {
  readonly sub: string;
  readonly username: string;
  readonly sessionVersion: number;
}

function parseSessionClaims(payload: { readonly sub?: unknown; readonly username?: unknown; readonly sv?: unknown }): SessionClaims | null {
  if (typeof payload.sub !== "string" || typeof payload.username !== "string") return null;
  if (payload.sv !== undefined && (typeof payload.sv !== "number" || !Number.isInteger(payload.sv) || payload.sv < 0)) return null;
  return { sub: payload.sub, username: payload.username, sessionVersion: payload.sv ?? 0 };
}

@Injectable()
export class SessionVerifier {
  constructor(
    @Inject(ConfigService) private readonly config: ConfigService,
    @Inject(PROFILE_AUTH_PORT) private readonly profiles: ProfileAuthPort,
    @Inject(SANCTIONS_READ_PORT) private readonly sanctions: SanctionsReadPort,
    @Inject(RuntimeLogger) private readonly logger: RuntimeLogger,
    @Optional() @Inject(MetricsService) private readonly metrics?: MetricsService,
  ) {}

  private rejected(reason: "unknown" | "user_blocked" | "version_mismatch" | "invalid_token"): null {
    this.logger.warn({ event: "auth.session.rejected", credentialType: "session", reason }, "Session rejected");
    this.metrics?.incRevokedCredentialUse("session", reason);
    return null;
  }

  async readSession(request: Request): Promise<SessionUser | null> {
    const token = sessionToken(request);
    if (token === undefined) return null;

    const secret = this.config.get<string>("JWT_SECRET");
    if (secret === undefined || secret === "") throw new Error("JWT_SECRET не задан");

    let payload: { readonly sub?: unknown; readonly username?: unknown; readonly sv?: unknown };
    try {
      ({ payload } = await jwtVerify(token, new TextEncoder().encode(secret), { algorithms: ["HS256"] }));
    } catch {
      return this.rejected("invalid_token");
    }

    const claims = parseSessionClaims(payload);
    if (claims === null) return this.rejected("invalid_token");

    const state = await this.profiles.loadOwnerAuthState(UserId(claims.sub));
    if (state === null) return this.rejected("unknown");
    if (state.status === "deleted") return this.rejected("user_blocked");
    const sanction = await this.sanctions.findActiveForUser(UserId(claims.sub));
    if (sanction !== null) throw new AccountRestrictedException(sanction.endsAt?.toISOString() ?? null);
    if (state.status !== "active") return this.rejected("user_blocked");
    if (claims.sessionVersion !== state.sessionVersion) return this.rejected("version_mismatch");

    return { id: claims.sub, username: claims.username, sessionVersion: claims.sessionVersion };
  }
}
