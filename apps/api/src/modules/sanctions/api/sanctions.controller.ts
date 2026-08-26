import { Body, Controller, Get, HttpCode, Inject, NotFoundException, Param, Post, Req, UnauthorizedException } from "@nestjs/common";
import { SESSION_USER, type RequestWithSession } from "../../../nest/auth/session-verifier.ts";
import { SanctionId, UserId } from "../../_kernel/brandedIds.ts";
import { SANCTIONS_PORT, type SanctionRecord, type SanctionsPort } from "../public/index.ts";
import { ApiSanctionOperation } from "./openapi.ts";
import { CancelSanctionDto, CreateSanctionDto } from "./sanctions.dto.ts";
const uuid = (value: string): string => { if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) throw new NotFoundException(); return value; };
const actor = (request: RequestWithSession) => { const current = request[SESSION_USER]; if (current === undefined) throw new UnauthorizedException(); return UserId(current.id); };
function response(sanction: SanctionRecord, staff: boolean) { const { createdBy: _createdBy, cancelledBy: _cancelledBy, ...self } = sanction; return staff ? sanction : self; }
@Controller() export class SanctionsController {
  constructor(@Inject(SANCTIONS_PORT) private readonly sanctions: SanctionsPort) {}
  @Post("sanctions") @HttpCode(201) @ApiSanctionOperation("Create a reversible sanction", "sanction")
  async create(@Req() request: RequestWithSession, @Body() body: CreateSanctionDto) { const result = await this.sanctions.create({ actorId: actor(request), targetId: UserId(uuid(body.targetId)), type: body.type, reasonCode: body.reasonCode, reasonNote: body.reasonNote?.trim() || null, evidenceUrl: body.evidenceUrl ?? null, endsAt: body.endsAt ? new Date(body.endsAt) : null, idempotencyKey: body.idempotencyKey }); return { ...result, sanction: response(result.sanction, true) }; }
  @Post("sanctions/:id/cancel") @HttpCode(200) @ApiSanctionOperation("Cancel a sanction", "sanction", "id")
  async cancel(@Req() request: RequestWithSession, @Param("id") id: string, @Body() body: CancelSanctionDto) { return response(await this.sanctions.cancel({ actorId: actor(request), sanctionId: SanctionId(uuid(id)), cancelReason: body.cancelReason.trim() }), true); }
  @Get("users/:id/sanctions/active") @ApiSanctionOperation("Read active sanctions", "sanction-null", "id")
  async active(@Req() request: RequestWithSession, @Param("id") id: string) { const result = await this.sanctions.activeForUser({ requesterId: actor(request), userId: UserId(uuid(id)) }); const item = result.sanctions[0]; return item === undefined ? null : response(item, result.requesterIsStaff); }
  @Get("users/:id/sanctions/history") @ApiSanctionOperation("Read sanctions history", "sanction-list", "id")
  async history(@Req() request: RequestWithSession, @Param("id") id: string) { const result = await this.sanctions.historyForUser({ requesterId: actor(request), userId: UserId(uuid(id)) }); return result.sanctions.map((item) => response(item, result.requesterIsStaff)); }
}
