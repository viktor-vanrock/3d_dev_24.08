import { Body, Controller, Delete, Get, Headers, HttpCode, Inject, Param, Patch, Post, Query, Req, Res, UnauthorizedException } from "@nestjs/common";
import type { Request, Response } from "express";
import { parseCookie } from "cookie";
import { randomUUID } from "node:crypto";
import { ConfigService } from "@nestjs/config";
import { UserId, type UserId as UserIdType } from "../../_kernel/brandedIds.ts";
import { SESSION_USER, type RequestWithSession } from "../../../nest/auth/session-verifier.ts";
import { getRequestId, type RequestWithId } from "../../../nest/observability/request-id.ts";
import { ProfileActivationService } from "../application/activation.service.ts";
import { ProfileFilamentsService } from "../application/filaments.service.ts";
import { ProfileMaterialsService } from "../application/materials.service.ts";
import { ProfilePrintersService } from "../application/printers.service.ts";
import {
  ActivationResponseDto,
  ActivationUpdateResponseDto,
  ActivationEventDto,
  CreateProfilePrinterDto,
  FilamentResponseDto,
  FilamentsResponseDto,
  InventoryWriteDto,
  MaterialResponseDto,
  MaterialsResponseDto,
  PrinterCompatibilityQueryDto,
  PrinterCompatibilityResponseDto,
  PrinterCommandResponseDto,
  PrinterCommandStatusResponseDto,
  PrinterLiveResponseDto,
  ProfileOkResponseDto,
  ProfilePrinterResponseDto,
  ProfilePrintersResponseDto,
  QueuePrinterCommandDto,
  UpdateActivationDto,
  UpdateProfilePrinterDto,
} from "./profile-inventory.dto.ts";
import { ApiProfileInventoryOperation } from "./profile-inventory.openapi.ts";
import { User } from "../../permissions/public/index.ts";

type ProfileRequest = Request & RequestWithSession & RequestWithId;
const ANON_COOKIE_MAX_AGE_MS = 730 * 24 * 60 * 60 * 1000;

function currentUserId(request: RequestWithSession): UserIdType {
  const session = request[SESSION_USER];
  if (session === undefined) throw new UnauthorizedException();
  return UserId(session.id);
}

@Controller("me")
@User()
export class ProfileInventoryController {
  constructor(
    @Inject(ProfileActivationService) private readonly activation: ProfileActivationService,
    @Inject(ProfileMaterialsService) private readonly materials: ProfileMaterialsService,
    @Inject(ProfileFilamentsService) private readonly filaments: ProfileFilamentsService,
    @Inject(ConfigService) private readonly config: ConfigService,
  ) {}

  @Get("activation")
  @ApiProfileInventoryOperation("Get activation profile", ActivationResponseDto)
  getActivation(@Req() request: ProfileRequest): Promise<ActivationResponseDto> {
    return this.activation.get(currentUserId(request));
  }

  @Patch("activation")
  @ApiProfileInventoryOperation("Update activation profile", ActivationUpdateResponseDto)
  updateActivation(@Req() request: ProfileRequest, @Body() body: UpdateActivationDto): Promise<ActivationUpdateResponseDto> {
    return this.activation.update(currentUserId(request), body);
  }

  @Post("activation/events")
  @HttpCode(202)
  @ApiProfileInventoryOperation("Record activation funnel event", ProfileOkResponseDto, { status: 202 })
  activationEvent(@Req() request: ProfileRequest, @Res({ passthrough: true }) response: Response, @Body() body: ActivationEventDto): Promise<ProfileOkResponseDto> {
    const cookies = parseCookie(request.headers.cookie ?? "");
    const anonId = cookies.portal_anon ?? randomUUID();
    if (cookies.portal_anon === undefined) {
      response.cookie("portal_anon", anonId, {
        domain: this.config.get<string>("COOKIE_DOMAIN") ?? ".3mf.tech",
        path: "/",
        httpOnly: true,
        secure: this.config.get<string>("NODE_ENV") === "production",
        sameSite: "lax",
        maxAge: ANON_COOKIE_MAX_AGE_MS,
      });
    }
    return this.activation.event(currentUserId(request), anonId, body.event_name ?? "", body.props ?? {});
  }

  @Get("materials")
  @ApiProfileInventoryOperation("List my materials", MaterialsResponseDto)
  listMaterials(@Req() request: ProfileRequest): Promise<MaterialsResponseDto> {
    return this.materials.list(currentUserId(request));
  }

  @Post("materials")
  @ApiProfileInventoryOperation("Add material to inventory", MaterialResponseDto, { status: 201 })
  createMaterial(@Req() request: ProfileRequest, @Body() body: InventoryWriteDto): Promise<MaterialResponseDto> {
    return this.materials.create(currentUserId(request), body);
  }

  @Patch("materials/:id")
  @ApiProfileInventoryOperation("Update inventory material", MaterialResponseDto, { pathParams: ["id"] })
  updateMaterial(@Req() request: ProfileRequest, @Param("id") id: string, @Body() body: InventoryWriteDto): Promise<MaterialResponseDto> {
    return this.materials.update(currentUserId(request), id, body);
  }

  @Delete("materials/:id")
  @ApiProfileInventoryOperation("Delete inventory material", ProfileOkResponseDto, { pathParams: ["id"] })
  deleteMaterial(@Req() request: ProfileRequest, @Param("id") id: string): Promise<ProfileOkResponseDto> {
    return this.materials.delete(currentUserId(request), id);
  }

  @Get("filaments")
  @ApiProfileInventoryOperation("List my filaments", FilamentsResponseDto)
  listFilaments(@Req() request: ProfileRequest): Promise<FilamentsResponseDto> {
    return this.filaments.list(currentUserId(request));
  }

  @Post("filaments")
  @ApiProfileInventoryOperation("Add filament to inventory", FilamentResponseDto, { status: 201 })
  createFilament(@Req() request: ProfileRequest, @Body() body: InventoryWriteDto): Promise<FilamentResponseDto> {
    return this.filaments.create(currentUserId(request), body);
  }

  @Patch("filaments/:id")
  @ApiProfileInventoryOperation("Update inventory filament", FilamentResponseDto, { pathParams: ["id"] })
  updateFilament(@Req() request: ProfileRequest, @Param("id") id: string, @Body() body: InventoryWriteDto): Promise<FilamentResponseDto> {
    return this.filaments.update(currentUserId(request), id, body);
  }

  @Delete("filaments/:id")
  @ApiProfileInventoryOperation("Delete inventory filament", ProfileOkResponseDto, { pathParams: ["id"] })
  deleteFilament(@Req() request: ProfileRequest, @Param("id") id: string): Promise<ProfileOkResponseDto> {
    return this.filaments.delete(currentUserId(request), id);
  }
}

@Controller("me")
@User()
export class ProfilePrintersController {
  constructor(@Inject(ProfilePrintersService) private readonly printers: ProfilePrintersService) {}

  @Get("printers")
  @ApiProfileInventoryOperation("List my printers", ProfilePrintersResponseDto)
  listPrinters(@Req() request: ProfileRequest): Promise<ProfilePrintersResponseDto> {
    return this.printers.list(currentUserId(request));
  }

  @Post("printers")
  @ApiProfileInventoryOperation("Add printer", ProfilePrinterResponseDto, { status: 201 })
  createPrinter(@Req() request: ProfileRequest, @Body() body: CreateProfilePrinterDto): Promise<ProfilePrinterResponseDto> {
    return this.printers.create(currentUserId(request), body);
  }

  @Patch("printers/:id")
  @ApiProfileInventoryOperation("Update printer", ProfilePrinterResponseDto, { pathParams: ["id"] })
  updatePrinter(@Req() request: ProfileRequest, @Param("id") id: string, @Body() body: UpdateProfilePrinterDto): Promise<ProfilePrinterResponseDto> {
    return this.printers.update(currentUserId(request), id, { ...body });
  }

  @Delete("printers/:id")
  @ApiProfileInventoryOperation("Delete printer", ProfileOkResponseDto, { pathParams: ["id"] })
  deletePrinter(@Req() request: ProfileRequest, @Param("id") id: string): Promise<ProfileOkResponseDto> {
    return this.printers.delete(currentUserId(request), id);
  }

  @Get("printers/:id/compat")
  @ApiProfileInventoryOperation("Check printer compatibility", PrinterCompatibilityResponseDto, { pathParams: ["id"] })
  compatibility(@Req() request: ProfileRequest, @Param("id") id: string, @Query() query: PrinterCompatibilityQueryDto): Promise<PrinterCompatibilityResponseDto> {
    return this.printers.compatibility(currentUserId(request), id, query.material_id ?? null, query.model_id ?? null);
  }

  @Get("printers/:id/live")
  @ApiProfileInventoryOperation("Get live printer state", PrinterLiveResponseDto, { pathParams: ["id"] })
  live(@Req() request: ProfileRequest, @Param("id") id: string): Promise<PrinterLiveResponseDto> {
    return this.printers.live(currentUserId(request), id);
  }

  @Post("printers/:id/commands")
  @HttpCode(202)
  @ApiProfileInventoryOperation("Queue printer command", PrinterCommandResponseDto, { status: 202, pathParams: ["id"] })
  queueCommand(
    @Req() request: ProfileRequest,
    @Param("id") id: string,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Body() body: QueuePrinterCommandDto,
  ): Promise<PrinterCommandResponseDto> {
    return this.printers.queueCommand(
      currentUserId(request),
      id,
      idempotencyKey,
      { command: body.command ?? "", slice_id: body.slice_id, file_name: body.file_name },
      getRequestId(request),
    );
  }

  @Get("printers/:id/commands/:commandId")
  @ApiProfileInventoryOperation("Get printer command status", PrinterCommandStatusResponseDto, { pathParams: ["id", "commandId"] })
  commandStatus(@Req() request: ProfileRequest, @Param("id") id: string, @Param("commandId") commandId: string): Promise<PrinterCommandStatusResponseDto> {
    return this.printers.commandStatus(currentUserId(request), id, commandId);
  }
}
