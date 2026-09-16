import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query, Req, Res, UnauthorizedException } from "@nestjs/common";
import type { Response } from "express";
import { randomUUID } from "node:crypto";
import { parseCookie } from "cookie";
import { ConfigService } from "@nestjs/config";
import { UserId, type UserId as UserIdType } from "../../_kernel/brandedIds.ts";
import { SESSION_USER, type RequestWithSession } from "../../../nest/auth/session-verifier.ts";
import { Permission, Permissions } from "../../permissions/public/index.ts";
import { PRINTERS_PORT, type PrintersPort } from "../public/index.ts";
import { ApiPrintersOperation } from "./openapi.ts";
import { PrinterResearchQueryDto, ResearchMediaDto, ResearchPrinterDto } from "./printers.dto.ts";

const ANON_COOKIE_NAME = "portal_anon";
const ANON_COOKIE_MAX_AGE_MS = 730 * 24 * 60 * 60 * 1000;

function sessionUser(request: RequestWithSession): UserIdType {
  const session = request[SESSION_USER];
  if (session === undefined) throw new UnauthorizedException();
  return UserId(session.id);
}

@Controller("data/printers")
@Permission(Permissions.RESEARCH_MANAGE_PRINTERS)
export class PrinterAdminController {
  constructor(
    @Inject(PRINTERS_PORT) private readonly printers: PrintersPort,
    @Inject(ConfigService) private readonly config: ConfigService,
  ) {}

  @Get("/")
  @ApiPrintersOperation("List researched printers", { auth: true })
  list(@Req() request: RequestWithSession, @Query() query: PrinterResearchQueryDto) {
    return this.printers.researchList(sessionUser(request), query);
  }

  @Post("/")
  @HttpCode(200)
  @ApiPrintersOperation("Upsert researched printer", { auth: true })
  async upsert(@Req() request: RequestWithSession, @Res({ passthrough: true }) response: Response, @Body() body: ResearchPrinterDto) {
    const cookies = parseCookie(request.headers.cookie ?? "");
    const anonId = cookies[ANON_COOKIE_NAME] ?? randomUUID();
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
    const result = await this.printers.researchUpsert(sessionUser(request), anonId, { ...body }, { audit: true });
    response.status(result.status);
    return result.body;
  }

  @Get(":slug")
  @ApiPrintersOperation("Read researched printer", { auth: true })
  detail(@Req() request: RequestWithSession, @Param("slug") slug: string) {
    return this.printers.researchDetail(sessionUser(request), slug);
  }

  @Post("media/presign")
  @HttpCode(200)
  @ApiPrintersOperation("Create printer media upload", { auth: true })
  upload(@Req() request: RequestWithSession, @Body() body: ResearchMediaDto) {
    return this.printers.researchUpload(sessionUser(request), body.slug, body.content_type);
  }
}
