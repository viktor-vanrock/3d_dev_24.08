import { Body, Controller, Get, HttpCode, Inject, Param, Patch, Post, Query, Req, UnauthorizedException } from "@nestjs/common";
import { ApiBearerAuth, ApiCookieAuth, ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { SESSION_USER, type RequestWithSession } from "../../../nest/auth/session-verifier.ts";
import { UserId } from "../../_kernel/brandedIds.ts";
import { Permission, Permissions } from "../../permissions/public/index.ts";
import { MaterialAdminService } from "../application/material-admin.service.ts";
import { MaterialAdminArchiveDto, MaterialAdminCreateDto, MaterialAdminItemDto, MaterialAdminListDto, MaterialAdminMutationDto, MaterialAdminOptionsDto, MaterialAdminPublishDto, MaterialAdminQueryDto, MaterialAdminRestoreDto, MaterialAdminUpdateDto } from "./material-admin.dto.ts";
import type { MaterialAdminListResult, MaterialAdminOptions, MaterialAdminRecord } from "../application/material-admin.service.ts";

function actor(request: RequestWithSession) {
  const session = request[SESSION_USER];
  if (session === undefined) throw new UnauthorizedException();
  return UserId(session.id);
}

@ApiTags("data-materials")
@ApiCookieAuth("portal_session")
@ApiBearerAuth("bearer")
@Controller("data/materials")
@Permission(Permissions.CATALOG_EDIT_ANY)
export class MaterialAdminController {
  constructor(@Inject(MaterialAdminService) private readonly materials: MaterialAdminService) {}

  @Get()
  @ApiOperation({ summary: "List managed materials" })
  @ApiResponse({ status: 200, type: MaterialAdminListDto })
  list(@Query() query: MaterialAdminQueryDto): Promise<MaterialAdminListResult> {
    return this.materials.list(query);
  }

  @Get("options")
  @ApiOperation({ summary: "List material form options" })
  @ApiResponse({ status: 200, type: MaterialAdminOptionsDto })
  options(): Promise<MaterialAdminOptions> {
    return this.materials.options();
  }

  @Get(":id")
  @ApiOperation({ summary: "Read a managed material" })
  @ApiResponse({ status: 200, type: MaterialAdminItemDto })
  find(@Param("id") id: string): Promise<MaterialAdminRecord> {
    return this.materials.find(id);
  }

  @Post()
  @ApiOperation({ summary: "Create a material draft" })
  @ApiResponse({ status: 201, type: MaterialAdminMutationDto })
  create(@Req() request: RequestWithSession, @Body() body: MaterialAdminCreateDto): Promise<{ readonly id: string; readonly version: number }> {
    return this.materials.create(actor(request), body);
  }

  @Patch(":id")
  @ApiOperation({ summary: "Update a managed material" })
  @ApiResponse({ status: 200, type: MaterialAdminMutationDto })
  update(@Req() request: RequestWithSession, @Param("id") id: string, @Body() body: MaterialAdminUpdateDto): Promise<{ readonly id: string; readonly version: number }> {
    return this.materials.update(actor(request), id, body);
  }

  @Post(":id/publish")
  @HttpCode(200)
  @ApiOperation({ summary: "Publish a managed material" })
  @ApiResponse({ status: 200, type: MaterialAdminMutationDto })
  publish(@Req() request: RequestWithSession, @Param("id") id: string, @Body() body: MaterialAdminPublishDto): Promise<{ readonly id: string; readonly version: number }> {
    return this.materials.publish(actor(request), id, body.version);
  }

  @Post(":id/restore")
  @HttpCode(200)
  @ApiOperation({ summary: "Restore an archived material as a draft" })
  @ApiResponse({ status: 200, type: MaterialAdminMutationDto })
  restore(@Req() request: RequestWithSession, @Param("id") id: string, @Body() body: MaterialAdminRestoreDto): Promise<{ readonly id: string; readonly version: number }> {
    return this.materials.restore(actor(request), id, body.version);
  }

  @Post(":id/archive")
  @HttpCode(200)
  @ApiOperation({ summary: "Archive a managed material" })
  @ApiResponse({ status: 200, type: MaterialAdminMutationDto })
  archive(@Req() request: RequestWithSession, @Param("id") id: string, @Body() body: MaterialAdminArchiveDto): Promise<{ readonly id: string; readonly version: number }> {
    return this.materials.archive(actor(request), id, body.version);
  }
}
