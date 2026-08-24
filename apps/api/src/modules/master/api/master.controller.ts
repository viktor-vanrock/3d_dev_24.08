import { Body, Controller, Get, HttpCode, Inject, Param, Patch, Post, Req } from "@nestjs/common";
import { SESSION_USER, type RequestWithSession } from "../../../nest/auth/session-verifier.ts";
import { UserId } from "../../_kernel/brandedIds.ts";
import { MASTER_PORT, type MasterPort } from "../public/index.ts";
import { MasterProfilePatchDto } from "./master.dto.ts";
import { ApiMasterOperation } from "./openapi.ts";

function userId(request: RequestWithSession) {
  const session = request[SESSION_USER];
  if (session === undefined) throw new Error("authenticated session missing");
  return UserId(session.id);
}

@Controller()
export class MasterController {
  constructor(@Inject(MASTER_PORT) private readonly master: MasterPort) {}

  @Post("me/become-master")
  @HttpCode(200)
  @ApiMasterOperation("Become a marketplace master")
  become(@Req() request: RequestWithSession) {
    return this.master.become(userId(request));
  }

  @Get("me/master")
  @ApiMasterOperation("Read own master status and profile")
  me(@Req() request: RequestWithSession) {
    return this.master.me(userId(request));
  }

  @Patch("me/master-profile")
  @ApiMasterOperation("Update own master storefront profile")
  update(@Req() request: RequestWithSession, @Body() body: MasterProfilePatchDto) {
    return this.master.update(userId(request), { ...body });
  }

  @Get("masters/:userId")
  @ApiMasterOperation("Read a public master storefront profile", { session: false, publicProfile: true })
  publicProfile(@Param("userId") id: string) {
    return this.master.publicProfile(id);
  }
}
