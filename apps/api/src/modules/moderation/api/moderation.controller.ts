import { Body, Controller, HttpCode, Inject, NotFoundException, Param, Post, Req, UnauthorizedException } from "@nestjs/common";
import { UserId } from "../../_kernel/brandedIds.ts";
import { SESSION_USER, type RequestWithSession } from "../../../nest/auth/session-verifier.ts";
import { MODERATION_PORT, type ModerationPort } from "../public/index.ts";
import { BanUserDto } from "./moderation.dto.ts";
import { ApiBanUserOperation } from "./openapi.ts";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Controller("users")
export class ModerationController {
  constructor(@Inject(MODERATION_PORT) private readonly moderation: ModerationPort) {}

  @Post(":id/ban")
  @HttpCode(200)
  @ApiBanUserOperation()
  async ban(@Req() request: RequestWithSession, @Param("id") id: string, @Body() _body: BanUserDto): Promise<{ readonly id: string; readonly status: "banned" }> {
    const session = request[SESSION_USER];
    if (session === undefined) throw new UnauthorizedException();
    if (!UUID_RE.test(id)) throw new NotFoundException();
    return this.moderation.banUser(UserId(session.id), UserId(id));
  }
}
