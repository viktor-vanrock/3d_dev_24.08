import { Body, Controller, Delete, Get, Inject, Param, Patch, Post, Query, Req, UnauthorizedException } from "@nestjs/common";
import { SESSION_USER, type RequestWithSession } from "../../../nest/auth/session-verifier.ts";
import { UserId, type UserId as UserIdType } from "../../_kernel/brandedIds.ts";
import { MASTER_SERVICES_PORT, type MasterServicesPort } from "../public/index.ts";
import { MasterServiceBodyDto, MasterServicesQueryDto } from "./master-services.dto.ts";
import { ApiMasterServicesOperation } from "./openapi.ts";
import { Public, User } from "../../permissions/public/index.ts";

function user(request: RequestWithSession): UserIdType {
  const session = request[SESSION_USER];
  if (session === undefined) throw new UnauthorizedException();
  return UserId(session.id);
}

@Controller()
@User()
export class MasterServicesController {
  constructor(@Inject(MASTER_SERVICES_PORT) private readonly services: MasterServicesPort) {}
  @Post("master-services") @ApiMasterServicesOperation("Create master service", { auth: true, status: 201, body: true }) create(
    @Req() request: RequestWithSession,
    @Body() body: MasterServiceBodyDto | undefined,
  ) {
    return this.services.create(user(request), { ...(body ?? {}) });
  }
  @Patch("master-services/:id") @ApiMasterServicesOperation("Update master service", { auth: true, body: true }) update(
    @Req() request: RequestWithSession,
    @Param("id") id: string,
    @Body() body: MasterServiceBodyDto | undefined,
  ) {
    return this.services.update(user(request), id, { ...(body ?? {}) });
  }
  @Delete("master-services/:id") @ApiMasterServicesOperation("Delete master service", { auth: true, deleted: true }) delete(
    @Req() request: RequestWithSession,
    @Param("id") id: string,
  ) {
    return this.services.delete(user(request), id);
  }
  @Get("master-services/:id") @Public() @ApiMasterServicesOperation("Read master service") detail(@Param("id") id: string) {
    return this.services.detail(id);
  }
  @Get("masters/:masterId/services") @Public() @ApiMasterServicesOperation("List master services", { list: true }) list(
    @Param("masterId") masterId: string,
    @Query() query: MasterServicesQueryDto,
  ) {
    return this.services.list(masterId, { ...query });
  }
}
