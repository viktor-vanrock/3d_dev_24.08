import { Body, Controller, Get, HttpCode, Inject, NotFoundException, Param, Post, Req, UnauthorizedException } from "@nestjs/common";
import { SESSION_USER, type RequestWithSession } from "../../../nest/auth/session-verifier.ts";
import { SanctionAppealId, SanctionId, UserId } from "../../_kernel/brandedIds.ts";
import { SANCTION_APPEALS_PORT, type SanctionAppealRecord, type SanctionAppealsPort } from "../public/index.ts";
import { ApiSanctionOperation } from "./openapi.ts";
import { ResolveAppealDto, SubmitAppealDto } from "./appeals.dto.ts";
import { Permission } from "../../permissions/decorators/permission.decorator.ts";
import { User } from "../../permissions/decorators/user.decorator.ts";
import { Permissions } from "../../permissions/domain/permissions.catalog.ts";
const uuid = (value: string): string => { if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) throw new NotFoundException(); return value; };
const actor = (request: RequestWithSession) => { const current = request[SESSION_USER]; if (current === undefined) throw new UnauthorizedException(); return UserId(current.id); };
function response(appeal: SanctionAppealRecord, staff: boolean) { const { resolvedBy: _resolvedBy, ...self } = appeal; return staff ? appeal : self; }
@Controller() export class AppealsController {
  constructor(@Inject(SANCTION_APPEALS_PORT) private readonly appeals: SanctionAppealsPort) {}
  @Post("sanctions/:id/appeals") @User() @HttpCode(201) @ApiSanctionOperation("Submit a sanction appeal", "appeal", "id")
  async submit(@Req() request: RequestWithSession, @Param("id") id: string, @Body() body: SubmitAppealDto) { return response(await this.appeals.submit({ submitterId: actor(request), sanctionId: SanctionId(uuid(id)), message: body.message.trim() }), false); }
  @Get("sanctions/:id/appeals") @Permission(Permissions.MODERATION_VIEW_REPORTS) @ApiSanctionOperation("List sanction appeals", "appeal-list", "id")
  async list(@Req() request: RequestWithSession, @Param("id") id: string) { const result = await this.appeals.list({ requesterId: actor(request), sanctionId: SanctionId(uuid(id)) }); return result.appeals.map((item) => response(item, result.requesterIsStaff)); }
  @Post("appeals/:id/resolve") @Permission(Permissions.MODERATION_RESOLVE_APPEAL) @HttpCode(200) @ApiSanctionOperation("Resolve a sanction appeal", "appeal", "id")
  async resolve(@Req() request: RequestWithSession, @Param("id") id: string, @Body() body: ResolveAppealDto) { return response(await this.appeals.resolve({ resolverId: actor(request), appealId: SanctionAppealId(uuid(id)), state: body.state, resolutionNote: body.resolutionNote.trim() }), true); }
}
