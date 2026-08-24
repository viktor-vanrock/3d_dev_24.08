import { Inject, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Response } from "express";
import { SignJWT } from "jose";
import { SESSION_COOKIE_NAME, type AuthenticatedUser } from "../domain/auth.ts";

const THIRTY_DAYS_SECONDS = 30 * 24 * 60 * 60;

@Injectable()
export class AuthSessionService {
  constructor(@Inject(ConfigService) private readonly config: ConfigService) {}

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
    return new SignJWT({ username: user.username })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(user.id)
      .setIssuedAt()
      .setExpirationTime(`${THIRTY_DAYS_SECONDS}s`)
      .sign(this.secret());
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

  clear(response: Response): void {
    const domain = this.cookieDomain();
    response.clearCookie(SESSION_COOKIE_NAME, {
      ...(domain === undefined ? {} : { domain }),
      path: "/",
    });
  }
}
