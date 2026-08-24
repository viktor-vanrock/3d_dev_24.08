import { Body, Controller, Get, HttpCode, Inject, InternalServerErrorException, NotFoundException, Post, Query, Req, Res, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Request, Response } from "express";
import { parseCookie } from "cookie";
import { randomUUID } from "node:crypto";
import { UserId } from "../../_kernel/brandedIds.ts";
import { PROFILE_AUTH_PORT, type ProfileAuthPort } from "../../profile/public/index.ts";
import { SessionVerifier } from "../../../nest/auth/session-verifier.ts";
import { getRequestId, type RequestWithId } from "../../../nest/observability/request-id.ts";
import { assertNestRateLimit } from "../../../nest/integration/rate-limit.ts";
import { APP_INTENT_COOKIE_NAME } from "../domain/auth.ts";
import { AuthService } from "../application/auth.service.ts";
import { AuthSessionService } from "../application/session.service.ts";
import { EmailStartDto, EmailVerifyDto, PasswordLoginDto, PlagIdCallbackQueryDto, PlagIdStartQueryDto } from "./auth.dto.ts";
import {
  ApiDevLoginOperation,
  ApiEmailStartOperation,
  ApiEmailVerifyOperation,
  ApiLogoutOperation,
  ApiPasswordLoginOperation,
  ApiPlagIdCallbackOperation,
  ApiPlagIdStartOperation,
  ApiSberIdStubOperation,
  ApiSessionOperation,
} from "./openapi.ts";

const APP_CALLBACK_SCHEME = "ultradevice";
const APP_INTENT_TTL_MS = 600 * 1000;
const ANON_COOKIE_NAME = "portal_anon";
const ANON_COOKIE_TTL_MS = 730 * 24 * 60 * 60 * 1000;
const SBER_NOT_READY = "SberID пока недоступен: ждём Client ID/Secret от партнёрской регистрации на портале Сбер ID " + "(docs/epics/auth.triple.md § «Метод 3»)";

function devBypassEnabled(config: ConfigService): boolean {
  const raw = config.get<string>("AUTH_DEV_BYPASS")?.trim().toLowerCase();
  return config.get<string>("NODE_ENV") !== "production" && (raw === "1" || raw === "true");
}

@Controller("auth")
export class AuthController {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(AuthSessionService) private readonly sessions: AuthSessionService,
    @Inject(SessionVerifier) private readonly verifier: SessionVerifier,
    @Inject(PROFILE_AUTH_PORT) private readonly profiles: ProfileAuthPort,
    @Inject(ConfigService) private readonly config: ConfigService,
  ) {}

  @Get("session")
  @ApiSessionOperation()
  async session(@Req() request: Request) {
    const claims = await this.verifier.readSession(request);
    if (claims === null) throw new UnauthorizedException();
    const user = await this.profiles.findSessionUser(UserId(claims.id));
    if (user === null) throw new UnauthorizedException();
    return {
      user: {
        id: user.id,
        username: user.username,
        display_name: user.displayName,
        avatar_url: user.avatarUrl,
        handle_confirmed: user.handleConfirmed,
        role: user.role,
      },
    };
  }

  @Post("logout")
  @HttpCode(200)
  @ApiLogoutOperation()
  logout(@Res({ passthrough: true }) response: Response): { readonly ok: true } {
    this.sessions.clear(response);
    return { ok: true };
  }

  @Post("email/start")
  @HttpCode(200)
  @ApiEmailStartOperation()
  async emailStart(@Body() body: EmailStartDto): Promise<{ readonly ok: true }> {
    await this.auth.startEmail(body.localPart, body.domain);
    return { ok: true };
  }

  @Post("email/verify")
  @HttpCode(200)
  @ApiEmailVerifyOperation()
  async emailVerify(@Req() request: Request, @Res({ passthrough: true }) response: Response, @Body() body: EmailVerifyDto): Promise<{ readonly ok: true }> {
    const cookies = parseCookie(request.headers.cookie ?? "");
    const anonId = cookies[ANON_COOKIE_NAME] || randomUUID();
    const result = await this.auth.verifyEmail(body.localPart, body.domain, body.code, anonId);
    if (result.created && cookies[ANON_COOKIE_NAME] === undefined) this.issueAnonCookie(response, anonId);
    await this.sessions.issue(response, result.user);
    return { ok: true };
  }

  @Post("password")
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
    return { ok: true, user: { id: user.id, username: user.username } };
  }

  @Get("plagid/start")
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
    if (appIntent) {
      response.clearCookie(APP_INTENT_COOKIE_NAME, { path: "/auth/plagid" });
      const token = await this.sessions.createToken(result.user);
      response.redirect(`${APP_CALLBACK_SCHEME}://auth?token=${encodeURIComponent(token)}`);
      return;
    }
    response.redirect(this.config.get<string>("WEB_APP_URL") ?? "https://3mf.tech");
  }

  @Get("sberid/start")
  @ApiSberIdStubOperation()
  sberIdStart(@Req() request: RequestWithId, @Res() response: Response): void {
    this.sberUnavailable(request, response);
  }

  @Get("sberid/callback")
  @ApiSberIdStubOperation()
  sberIdCallback(@Req() request: RequestWithId, @Res() response: Response): void {
    this.sberUnavailable(request, response);
  }

  @Post("dev")
  @HttpCode(200)
  @ApiDevLoginOperation()
  async devLogin(@Res({ passthrough: true }) response: Response) {
    if (!devBypassEnabled(this.config)) throw new NotFoundException();
    const user = await this.auth.devLogin();
    if (user === null) throw new InternalServerErrorException();
    await this.sessions.issue(response, user);
    return { ok: true, user: { id: user.id, username: user.username } };
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
