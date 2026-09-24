import { Body, Controller, Get, HttpCode, Inject, InternalServerErrorException, NotFoundException, Post, Query, Req, Res, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Request, Response } from "express";
import { parseCookie } from "cookie";
import { randomUUID } from "node:crypto";
import { AUDIT_LOG_PORT, type AuditLogPort } from "../../audit/public/index.ts";
import { UserId } from "../../_kernel/brandedIds.ts";
import { PROFILE_AUTH_PORT, type ProfileAuthPort } from "../../profile/public/index.ts";
import { SESSION_USER, SessionVerifier, type RequestWithSession } from "../../../nest/auth/session-verifier.ts";
import { getRequestId, type RequestWithId } from "../../../nest/observability/request-id.ts";
import { MetricsService } from "../../../nest/observability/metrics.service.ts";
import { assertNestRateLimit } from "../../../nest/integration/rate-limit.ts";
import { APP_INTENT_COOKIE_NAME } from "../domain/auth.ts";
import { AuthService } from "../application/auth.service.ts";
import { AuthSessionService } from "../application/session.service.ts";
import { EmailStartDto, EmailVerifyDto, PasswordLoginDto, PlagIdCallbackQueryDto, PlagIdStartQueryDto } from "./auth.dto.ts";
import {
  ApiDevAvailabilityOperation,
  ApiDevLoginOperation,
  ApiEmailStartOperation,
  ApiEmailVerifyOperation,
  ApiLogoutOperation,
  ApiLogoutAllOperation,
  ApiPasswordLoginOperation,
  ApiPlagIdCallbackOperation,
  ApiPlagIdStartOperation,
  ApiSberIdStubOperation,
  ApiSessionOperation,
} from "./openapi.ts";
import { Internal, PermissionsService, Public, User } from "../../permissions/public/index.ts";

const APP_CALLBACK_SCHEME = "ultradevice";
const APP_INTENT_TTL_MS = 600 * 1000;
const ANON_COOKIE_NAME = "portal_anon";
const ANON_COOKIE_TTL_MS = 730 * 24 * 60 * 60 * 1000;
const DEV_COOKIE_TTL_MS = 365 * 24 * 60 * 60 * 1000;
const SBER_NOT_READY = "SberID пока недоступен: ждём Client ID/Secret от партнёрской регистрации на портале Сбер ID " + "(docs/epics/auth.triple.md § «Метод 3»)";

function devBypassEnabled(config: ConfigService): boolean {
  const raw = config.get<string>("AUTH_DEV_BYPASS")?.trim().toLowerCase();
  // AUTH_DEV_BYPASS явно управляет bypass независимо от NODE_ENV
  return raw === "1" || raw === "true";
}

@Controller("auth")
export class AuthController {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(AuthSessionService) private readonly sessions: AuthSessionService,
    @Inject(SessionVerifier) private readonly verifier: SessionVerifier,
    @Inject(PROFILE_AUTH_PORT) private readonly profiles: ProfileAuthPort,
    @Inject(ConfigService) private readonly config: ConfigService,
    @Inject(MetricsService) private readonly metrics: MetricsService,
    @Inject(PermissionsService) private readonly permissions: PermissionsService,
    @Inject(AUDIT_LOG_PORT) private readonly audit: AuditLogPort,
  ) {}

  @Get("session")
  @User()
  @ApiSessionOperation()
  async session(@Req() request: Request) {
    const claims = await this.verifier.readSession(request);
    if (claims === null) throw new UnauthorizedException();
    const user = await this.profiles.findSessionUser(UserId(claims.id));
    if (user === null) throw new UnauthorizedException();
    const capabilities = await this.permissions.dataCapabilities(user.id);
    return {
      user: {
        id: user.id,
        username: user.username,
        display_name: user.displayName,
        avatar_url: user.avatarUrl,
        handle_confirmed: user.handleConfirmed,
        role: user.role,
        capabilities,
      },
    };
  }

  @Post("logout")
  @Public()
  @HttpCode(200)
  @ApiLogoutOperation()
  async logout(@Req() request: RequestWithSession, @Res({ passthrough: true }) response: Response): Promise<{ readonly ok: true }> {
    const user = await this.verifier.readSession(request);
    if (user !== null) await this.record(user.id, "auth.logout", getRequestId(request));
    this.sessions.clear(response);
    return { ok: true };
  }

  @Post("logout-all")
  @User()
  @HttpCode(200)
  @ApiLogoutAllOperation()
  async logoutAll(@Req() request: RequestWithSession, @Res({ passthrough: true }) response: Response): Promise<{ readonly ok: true }> {
    const session = request[SESSION_USER];
    if (session === undefined) throw new UnauthorizedException();
    await this.sessions.logoutAll(UserId(session.id));
    await this.record(session.id, "auth.logout_all", getRequestId(request));
    this.metrics.incCredentialRevocation("session", "logout_all");
    this.sessions.clear(response);
    return { ok: true };
  }

  @Post("email/start")
  @Public()
  @HttpCode(200)
  @ApiEmailStartOperation()
  async emailStart(@Body() body: EmailStartDto): Promise<{ readonly ok: true }> {
    await this.auth.startEmail(body.localPart, body.domain);
    return { ok: true };
  }

  @Post("email/verify")
  @Public()
  @HttpCode(200)
  @ApiEmailVerifyOperation()
  async emailVerify(@Req() request: Request, @Res({ passthrough: true }) response: Response, @Body() body: EmailVerifyDto): Promise<{ readonly ok: true }> {
    const cookies = parseCookie(request.headers.cookie ?? "");
    const anonId = cookies[ANON_COOKIE_NAME] || randomUUID();
    const result = await this.auth.verifyEmail(body.localPart, body.domain, body.code, anonId);
    if (result.created && cookies[ANON_COOKIE_NAME] === undefined) this.issueAnonCookie(response, anonId);
    await this.sessions.issue(response, result.user);
    await this.record(result.user.id, "auth.login.success", getRequestId(request));
    return { ok: true };
  }

  @Post("password")
  @Public()
  @HttpCode(200)
  @ApiPasswordLoginOperation()
  async passwordLogin(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @Body() body: PasswordLoginDto,
  ): Promise<{ readonly ok: true; readonly user: { readonly id: string; readonly username: string } }> {
    const rateLimitIdentity = typeof body.username === "string" ? body.username.trim().toLowerCase() : "invalid";
    await assertNestRateLimit(request, "auth_password", rateLimitIdentity);
    const user = await this.auth.loginPassword(body.username, body.password);
    await this.sessions.issue(response, user);
    await this.record(user.id, "auth.login.success", getRequestId(request));
    return { ok: true, user: { id: user.id, username: user.username } };
  }

  @Get("plagid/start")
  @Public()
  @ApiPlagIdStartOperation()
  plagIdStart(@Query() query: PlagIdStartQueryDto, @Res() response: Response): void {
    const callbackUrl = this.config.get<string>("PLAGID_CALLBACK_URL") ?? "https://api.3mf.tech/auth/plagid/callback";
    if (query.app === "1") {
      response.cookie(APP_INTENT_COOKIE_NAME, "1", {
        path: "/auth/plagid",
        httpOnly: true,
        secure: this.config.get<string>("NODE_ENV") === "production",
        sameSite: "lax",
        maxAge: APP_INTENT_TTL_MS,
      });
    }
    const target = new URL("https://auth.plag.space/login");
    target.searchParams.set("redirect", callbackUrl);
    response.redirect(target.toString());
  }

  @Get("plagid/callback")
  @Public()
  @ApiPlagIdCallbackOperation()
  async plagIdCallback(@Req() request: Request, @Res() response: Response, @Query() query: PlagIdCallbackQueryDto): Promise<void> {
    const cookies = parseCookie(request.headers.cookie ?? "");
    const appIntent = cookies[APP_INTENT_COOKIE_NAME] === "1";
    if (!query.token) {
      const reason = query.reason ?? "missing_token";
      this.auth.auditFailure("plag_id", query.reason === undefined ? "missing_token" : "provider_denied");
      if (appIntent) {
        response.clearCookie(APP_INTENT_COOKIE_NAME, { path: "/auth/plagid" });
        response.redirect(`${APP_CALLBACK_SCHEME}://auth?error=${encodeURIComponent(reason)}`);
        return;
      }
      response.redirect(`${this.config.get<string>("WEB_APP_URL") ?? "https://3mf.tech"}/?error=${encodeURIComponent(reason)}`);
      return;
    }
    const secret = this.config.get<string>("PLAGID_EXTERNAL_TOKEN_SECRET");
    if (secret === undefined || secret === "") throw new InternalServerErrorException();
    const anonId = cookies[ANON_COOKIE_NAME] || randomUUID();
    const result = await this.auth.loginPlagId(query.token, secret, anonId);
    if (result.created && cookies[ANON_COOKIE_NAME] === undefined) this.issueAnonCookie(response, anonId);
    await this.sessions.issue(response, result.user);
    await this.record(result.user.id, "auth.login.success", getRequestId(request));
    if (appIntent) {
      response.clearCookie(APP_INTENT_COOKIE_NAME, { path: "/auth/plagid" });
      const token = await this.sessions.createToken(result.user);
      response.redirect(`${APP_CALLBACK_SCHEME}://auth?token=${encodeURIComponent(token)}`);
      return;
    }
    response.redirect(this.config.get<string>("WEB_APP_URL") ?? "https://3mf.tech");
  }

  @Get("sberid/start")
  @Public()
  @ApiSberIdStubOperation()
  sberIdStart(@Req() request: RequestWithId, @Res() response: Response): void {
    this.sberUnavailable(request, response);
  }

  @Get("sberid/callback")
  @Public()
  @ApiSberIdStubOperation()
  sberIdCallback(@Req() request: RequestWithId, @Res() response: Response): void {
    this.sberUnavailable(request, response);
  }

  @Post("dev")
  @Internal()
  @HttpCode(200)
  @ApiDevLoginOperation()
  async devLogin(@Res({ passthrough: true }) response: Response) {
    if (!devBypassEnabled(this.config)) throw new NotFoundException();
    const user = await this.auth.devLogin();
    if (user === null) throw new InternalServerErrorException();
    await this.sessions.issue(response, user);
    await this.record(user.id, "auth.login.success", randomUUID());
    return { ok: true, user: { id: user.id, username: user.username } };
  }

  @Get("dev/available")
  @Internal()
  @HttpCode(200)
  @ApiDevAvailabilityOperation()
  devAvailable(@Res({ passthrough: true }) response: Response): { readonly available: boolean } {
    const available = devBypassEnabled(this.config);
    if (available) this.issueDevCookie(response);
    return { available };
  }

  private issueAnonCookie(response: Response, anonId: string): void {
    response.cookie(ANON_COOKIE_NAME, anonId, {
      domain: this.config.get<string>("COOKIE_DOMAIN") ?? ".3mf.tech",
      path: "/",
      httpOnly: true,
      secure: this.config.get<string>("NODE_ENV") === "production",
      sameSite: "lax",
      maxAge: ANON_COOKIE_TTL_MS,
    });
  }

  private record(userId: string, action: "auth.login.success" | "auth.logout" | "auth.logout_all", correlationId: string): Promise<void> {
    return this.audit.record({ schema_version: 1, id: randomUUID(), actor_user_id: userId, actor_type: "user", subject_type: "user", subject_id: userId, action, before_state: null, after_state: null, reason: null, correlation_id: correlationId, causation_id: null, idempotency_key: `${action}:${userId}:${correlationId}`, occurred_at: new Date(), legal_hold: false });
  }

  private issueDevCookie(response: Response): void {
    response.cookie("is_dev", "true", {
      path: "/",
      httpOnly: false,
      secure: false,
      sameSite: "lax",
      maxAge: DEV_COOKIE_TTL_MS,
    });
  }

  private sberUnavailable(request: RequestWithId, response: Response): void {
    this.auth.auditFailure("sber_id", "not_implemented");
    response.status(501).json({
      error: {
        code: "auth.sberid_not_implemented.v1",
        message: SBER_NOT_READY,
        requestId: getRequestId(request),
      },
    });
  }
}
