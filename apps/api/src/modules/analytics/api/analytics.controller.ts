import { Body, Controller, Get, HttpCode, Inject, Post, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import { parseCookie } from "cookie";
import { randomUUID } from "node:crypto";
import { ConfigService } from "@nestjs/config";
import { UserId } from "../../_kernel/brandedIds.ts";
import { SessionVerifier } from "../../../nest/auth/session-verifier.ts";
import { ANALYTICS_PORT, type AnalyticsPort } from "../public/index.ts";
import { RecordConsentDto } from "./analytics.dto.ts";
import { ApiAnalyticsHealthOperation, ApiConsentOperation } from "./openapi.ts";
import { Permission, Permissions, Public } from "../../permissions/public/index.ts";

const ANON_COOKIE_NAME = "portal_anon";
const ANON_COOKIE_MAX_AGE_MS = 730 * 24 * 60 * 60 * 1000;

@Controller()
export class AnalyticsController {
  constructor(
    @Inject(ANALYTICS_PORT) private readonly analytics: AnalyticsPort,
    @Inject(SessionVerifier) private readonly sessions: SessionVerifier,
    @Inject(ConfigService) private readonly config: ConfigService,
  ) {}

  @Post("consent")
  @Public()
  @HttpCode(201)
  @ApiConsentOperation()
  async consent(@Req() request: Request, @Res({ passthrough: true }) response: Response, @Body() body: RecordConsentDto): Promise<{ ok: true }> {
    const cookies = parseCookie(request.headers.cookie ?? "");
    const anonId = cookies[ANON_COOKIE_NAME] || randomUUID();
    if (cookies[ANON_COOKIE_NAME] === undefined) {
      response.cookie(ANON_COOKIE_NAME, anonId, {
        domain: this.config.get<string>("COOKIE_DOMAIN") ?? ".3mf.tech",
        path: "/",
        httpOnly: true,
        secure: this.config.get<string>("NODE_ENV") === "production",
        sameSite: "lax",
        maxAge: ANON_COOKIE_MAX_AGE_MS,
      });
    }
    const session = await this.sessions.readSession(request);
    await this.analytics.recordConsent({ anonId, userId: session === null ? null : UserId(session.id) }, body.action, body.version);
    return { ok: true };
  }

  @Get("analytics/health")
  @Permission(Permissions.ANALYTICS_VIEW_HEALTH)
  @ApiAnalyticsHealthOperation()
  async health() {
    return this.analytics.health();
  }
}
