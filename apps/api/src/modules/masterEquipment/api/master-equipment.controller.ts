import { Body, Controller, Delete, Get, Inject, Param, Patch, Post, Query, Req, UnauthorizedException } from "@nestjs/common";
import { SESSION_USER, type RequestWithSession } from "../../../nest/auth/session-verifier.ts";
import { UserId, type UserId as UserIdType } from "../../_kernel/brandedIds.ts";
import { MASTER_EQUIPMENT_PORT, type MasterEquipmentPort } from "../public/index.ts";
import { MasterEquipmentBodyDto, MasterEquipmentQueryDto } from "./master-equipment.dto.ts";
import { ApiMasterEquipmentOperation } from "./openapi.ts";

function user(request: RequestWithSession): UserIdType {
  const session = request[SESSION_USER];
  if (session === undefined) throw new UnauthorizedException();
  return UserId(session.id);
}

@Controller()
export class MasterEquipmentController {
  constructor(@Inject(MASTER_EQUIPMENT_PORT) private readonly equipment: MasterEquipmentPort) {}

  @Post("master-equipment")
  @ApiMasterEquipmentOperation("Add equipment to the current master's storefront", { created: true })
  create(@Req() request: RequestWithSession, @Body() body: MasterEquipmentBodyDto) {
    return this.equipment.create(user(request), { ...body });
  }

  @Patch("master-equipment/:id")
  @ApiMasterEquipmentOperation("Update owned storefront equipment")
  update(@Req() request: RequestWithSession, @Param("id") id: string, @Body() body: MasterEquipmentBodyDto) {
    return this.equipment.update(user(request), id, { ...body });
  }

  @Delete("master-equipment/:id")
  @ApiMasterEquipmentOperation("Remove owned storefront equipment", { deleted: true })
  delete(@Req() request: RequestWithSession, @Param("id") id: string) {
    return this.equipment.delete(user(request), id);
  }

  @Get("masters/:masterId/equipment")
  @ApiMasterEquipmentOperation("List a master's public equipment", { public: true })
  list(@Param("masterId") masterId: string, @Query() query: MasterEquipmentQueryDto) {
    return this.equipment.list(masterId, { ...query });
  }
}
