import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Patch, Post, Query, Req, Res, UnauthorizedException } from "@nestjs/common";
import type { Request, Response } from "express";
import { ConfigService } from "@nestjs/config";
import { randomUUID } from "node:crypto";
import { parseCookie } from "cookie";
import { UserId, type UserId as UserIdType } from "../../_kernel/brandedIds.ts";
import { SESSION_USER, type RequestWithSession } from "../../../nest/auth/session-verifier.ts";
import { PRINTER_RESEARCH_AUTH_PORT, PRINTERS_PORT, type PrinterResearchAuthPort, type PrintersPort } from "../public/index.ts";
import { ApiPrintersOperation } from "./openapi.ts";
import {
  CommunityFirmwareCreateDto,
  CommunityFirmwareQueryDto,
  CommunityFirmwareUpdateDto,
  IdentifyPrinterDto,
  PrinterReportDto,
  PrinterReportsQueryDto,
  PrusaConnectDto,
  ResearchMediaDto,
  ResearchPrinterDto,
} from "./printers.dto.ts";
import { Internal } from "../../permissions/decorators/internal.decorator.ts";
import { Permission } from "../../permissions/decorators/permission.decorator.ts";
import { Public } from "../../permissions/decorators/public.decorator.ts";
import { User } from "../../permissions/decorators/user.decorator.ts";
import { Permissions } from "../../permissions/domain/permissions.catalog.ts";

function user(request: RequestWithSession): UserIdType {
  const session = request[SESSION_USER];
  if (session === undefined) throw new UnauthorizedException();
  return UserId(session.id);
}

const ANON_COOKIE_NAME = "portal_anon";
const ANON_COOKIE_MAX_AGE_MS = 730 * 24 * 60 * 60 * 1000;

@Controller()
@User()
export class PrintersController {
  constructor(
    @Inject(PRINTERS_PORT) private readonly printers: PrintersPort,
    @Inject(PRINTER_RESEARCH_AUTH_PORT) private readonly researchAuth: PrinterResearchAuthPort,
    @Inject(ConfigService) private readonly config: ConfigService,
  ) {}

  private async researchUser(request: Request): Promise<UserIdType> {
    const value = await this.researchAuth.resolveUser({ authorization: request.headers.authorization, cookie: request.headers.cookie });
    if (value === null) throw new UnauthorizedException();
    return value;
  }

  @Get("community-firmware")
  @Public()
  @ApiPrintersOperation("List community firmware")
  firmware(@Query() query: CommunityFirmwareQueryDto) {
    return this.printers.communityFirmwareList({ model: query.model, printer_id: query.printer_id, limit: query.limit, offset: query.offset });
  }
  @Post("community-firmware")
  @ApiPrintersOperation("Create community firmware", { auth: true, created: true })
  createFirmware(@Req() request: RequestWithSession, @Body() body: CommunityFirmwareCreateDto) {
    return this.printers.communityFirmwareCreate(user(request), { ...body });
  }
  @Patch("community-firmware/:id")
  @ApiPrintersOperation("Update community firmware", { auth: true })
  updateFirmware(@Req() request: RequestWithSession, @Param("id") id: string, @Body() body: CommunityFirmwareUpdateDto) {
    return this.printers.communityFirmwareUpdate(user(request), id, { ...body });
  }
  @Delete("community-firmware/:id")
  @HttpCode(204)
  @ApiPrintersOperation("Delete community firmware", { auth: true, noContent: true })
  deleteFirmware(@Req() request: RequestWithSession, @Param("id") id: string) {
    return this.printers.communityFirmwareDelete(user(request), id);
  }

  @Get("printer-connect")
  @ApiPrintersOperation("Read local printer discovery recipe", { auth: true })
  connect(@Req() request: RequestWithSession) {
    user(request);
    return this.printers.connectRecipe();
  }
  @Post("printers/identify")
  @HttpCode(200)
  @ApiPrintersOperation("Identify a local printer", { auth: true })
  identify(@Req() request: RequestWithSession, @Body() body: IdentifyPrinterDto) {
    user(request);
    return this.printers.identify(body);
  }

  @Post("me/connectors/prusa")
  @ApiPrintersOperation("Connect Prusa account", { auth: true, created: true })
  prusaConnect(@Req() request: RequestWithSession, @Body() body: PrusaConnectDto) {
    return this.printers.connectPrusa(user(request), body.api_key);
  }
  @Post("me/connectors/prusa/sync")
  @HttpCode(200)
  @ApiPrintersOperation("Synchronize Prusa account", { auth: true })
  prusaSync(@Req() request: RequestWithSession) {
    return this.printers.syncPrusa(user(request));
  }
  @Get("me/connectors/prusa")
  @ApiPrintersOperation("Read Prusa connection", { auth: true })
  prusaStatus(@Req() request: RequestWithSession) {
    return this.printers.prusaStatus(user(request));
  }
  @Delete("me/connectors/prusa")
  @ApiPrintersOperation("Disconnect Prusa account", { auth: true })
  prusaDisconnect(@Req() request: RequestWithSession) {
    return this.printers.disconnectPrusa(user(request));
  }

  @Post("research/printers")
  @Internal()
  @HttpCode(200)
  @ApiPrintersOperation("Upsert researched printer", { auth: true })
  async researchUpsert(@Req() request: Request, @Res({ passthrough: true }) response: Response, @Body() body: ResearchPrinterDto) {
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
    const result = await this.printers.researchUpsert(await this.researchUser(request), anonId, { ...body });
    response.status(result.status);
    return result.body;
  }
  @Get("research/printers/:slug")
  @Internal()
  @ApiPrintersOperation("Read researched printer", { auth: true })
  async researchDetail(@Req() request: Request, @Param("slug") slug: string) {
    return this.printers.researchDetail(await this.researchUser(request), slug);
  }
  @Post("research/printers/media/presign")
  @Internal()
  @HttpCode(200)
  @ApiPrintersOperation("Create printer media upload", { auth: true })
  async researchUpload(@Req() request: Request, @Body() body: ResearchMediaDto) {
    return this.printers.researchUpload(await this.researchUser(request), body.slug, body.content_type);
  }
  @Get("research/media/*key")
  @Internal()
  @ApiPrintersOperation("Read printer research media", { auth: true, status: 302 })
  async researchMedia(@Req() request: Request, @Param("key") rawKey: string | string[], @Res() response: Response) {
    const key = Array.isArray(rawKey) ? rawKey.join("/") : rawKey;
    response.redirect(302, await this.printers.researchMedia(await this.researchUser(request), key));
  }

  @Post("printers/:id/report")
  @ApiPrintersOperation("Report inaccurate printer data", { auth: true, created: true })
  report(@Req() request: RequestWithSession, @Param("id") id: string, @Body() body: PrinterReportDto) {
    return this.printers.report(user(request), id, { ...body });
  }
  @Get("printers/reports")
  @Permission(Permissions.CATALOG_REVIEW_PRINTER_REPORTS)
  @ApiPrintersOperation("List printer reports", { auth: true })
  reports(@Req() request: RequestWithSession, @Query() query: PrinterReportsQueryDto) {
    return this.printers.reports(user(request), query.status);
  }
  @Post("printers/reports/:reportId/reject")
  @Permission(Permissions.CATALOG_REVIEW_PRINTER_REPORTS)
  @HttpCode(200)
  @ApiPrintersOperation("Reject printer report", { auth: true })
  reject(@Req() request: RequestWithSession, @Param("reportId") reportId: string) {
    return this.printers.rejectReport(user(request), reportId);
  }
  @Post("printers/reports/:reportId/approve")
  @Permission(Permissions.CATALOG_REVIEW_PRINTER_REPORTS)
  @HttpCode(200)
  @ApiPrintersOperation("Approve printer report", { auth: true })
  approve(@Req() request: RequestWithSession, @Param("reportId") reportId: string) {
    return this.printers.approveReport(user(request), reportId);
  }
}
