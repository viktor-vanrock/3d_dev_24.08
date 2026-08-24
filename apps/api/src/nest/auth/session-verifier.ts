import { Inject, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { parseCookie } from "cookie";
import type { Request } from "express";
import { jwtVerify } from "jose";

export const SESSION_COOKIE_NAME = "portal_session";
export const SESSION_USER = Symbol("SESSION_USER");

export interface SessionUser {
  readonly id: string;
  readonly username: string;
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

@Injectable()
export class SessionVerifier {
  constructor(@Inject(ConfigService) private readonly config: ConfigService) {}

  async readSession(request: Request): Promise<SessionUser | null> {
    const token = sessionToken(request);
    if (token === undefined) return null;

    const secret = this.config.get<string>("JWT_SECRET");
    if (secret === undefined || secret === "") throw new Error("JWT_SECRET не задан");

    try {
      const { payload } = await jwtVerify(token, new TextEncoder().encode(secret));
      if (typeof payload.sub !== "string" || typeof payload.username !== "string") return null;
      return { id: payload.sub, username: payload.username };
    } catch {
      return null;
    }
  }
}
