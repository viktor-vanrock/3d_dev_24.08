import { Body, Controller, Delete, Get, Headers, HttpCode, Inject, Param, Post, Req, Res, UnauthorizedException } from "@nestjs/common";
import type { Response } from "express";
import { SESSION_USER, type RequestWithSession } from "../../../nest/auth/session-verifier.ts";
import { getRequestId } from "../../../nest/observability/request-id.ts";
import { UserId, type UserId as UserIdType } from "../../_kernel/brandedIds.ts";
import { DEVICES_PORT, type DevicesPort } from "../public/index.ts";
import {
  DeviceCommandDto,
  DeviceEnrollCodeDto,
  DeviceEnrollmentDto,
  DeviceIncidentEnvelopeDto,
  DeviceIncidentListDto,
  DeviceLooseBodyDto,
  DeviceOkDto,
  DevicePrintRequestDto,
  DeviceProfileTransferDto,
  DeviceShareEnvelopeDto,
  DeviceTransferDto,
} from "./devices.dto.ts";
import { ApiDevicesOperation } from "./openapi.ts";

function actor(request: RequestWithSession): UserIdType {
  const session = request[SESSION_USER];
  if (session === undefined) throw new UnauthorizedException();
  return UserId(session.id);
}

@Controller()
export class DevicesController {
  constructor(@Inject(DEVICES_PORT) private readonly devices: DevicesPort) {}

  @Post("me/devices/enroll-codes")
  @ApiDevicesOperation("Create a one-time device enrollment code", { status: 201, body: true, responseType: DeviceEnrollCodeDto })
  async createEnroll(@Req() req: RequestWithSession, @Body() body: DeviceLooseBodyDto, @Res() res: Response) {
    const out = await this.devices.createEnrollCode(actor(req), { ...body });
    res.status(out.status).json(out.body);
  }

  @Post("me/devices/enroll-codes/:enrollCodeId/revoke")
  @HttpCode(204)
  @ApiDevicesOperation("Revoke an unused enrollment code", { status: 204 })
  async revokeEnroll(@Req() req: RequestWithSession, @Param("enrollCodeId") id: string): Promise<void> {
    await this.devices.revokeEnrollCode(actor(req), id);
  }

  @Post("me/devices/:deviceId/revoke")
  @ApiDevicesOperation("Revoke the agent linked to one device", { body: true, responseType: DeviceOkDto })
  revoke(@Req() req: RequestWithSession, @Param("deviceId") id: string, @Body() body: DeviceLooseBodyDto) {
    return this.devices.revokeDevice(actor(req), id, body.reason, getRequestId(req));
  }

  @Get("devices/agent/install.sh")
  @ApiDevicesOperation("Download the device agent installer", { session: false, contentType: "text/x-shellscript" })
  install(@Res() res: Response): void {
    const out = this.devices.installScript();
    res.type(out.contentType).send(out.body);
  }

  @Post("devices/agent/enroll")
  @ApiDevicesOperation("Redeem an enrollment code", { session: false, status: 201, body: true, responseType: DeviceEnrollmentDto })
  async enroll(@Req() req: RequestWithSession, @Body() body: DeviceLooseBodyDto, @Res() res: Response) {
    const out = await this.devices.enrollAgent({ ...body }, getRequestId(req));
    res.status(out.status).json(out.body);
  }

  @Post("devices/agent/recover")
  @ApiDevicesOperation("Recover or rotate a device agent identity from a one-time recovery credential", { session: false, status: 201, body: true, responseType: DeviceEnrollmentDto })
  async recover(@Req() req: RequestWithSession, @Body() body: DeviceLooseBodyDto, @Res() res: Response) {
    const out = await this.devices.enrollAgent({ ...body }, getRequestId(req), "recovery");
    res.status(out.status).json(out.body);
  }

  @Post("me/devices/:deviceId/shares")
  @ApiDevicesOperation("Create or update a device share", { status: 201, additionalSuccess: [200], body: true, responseType: DeviceShareEnvelopeDto })
  async share(@Req() req: RequestWithSession, @Param("deviceId") id: string, @Body() body: DeviceLooseBodyDto, @Res() res: Response) {
    const out = await this.devices.upsertShare(actor(req), id, { ...body });
    res.status(out.status).json(out.body);
  }

  @Delete("me/devices/:deviceId/shares/:userId")
  @ApiDevicesOperation("Remove a device share", { responseType: DeviceOkDto })
  unshare(@Req() req: RequestWithSession, @Param("deviceId") id: string, @Param("userId") userId: string) {
    return this.devices.deleteShare(actor(req), id, userId);
  }

  @Post("me/devices/:deviceId/commands")
  @HttpCode(202)
  @ApiDevicesOperation("Queue a device control command", { status: 202, body: true, responseType: DeviceCommandDto })
  command(@Req() req: RequestWithSession, @Param("deviceId") id: string, @Body() body: DeviceLooseBodyDto, @Headers("idempotency-key") key: unknown) {
    return this.devices.createCommand(actor(req), id, { ...body }, key, getRequestId(req));
  }

  @Get("me/devices/:deviceId/commands/:commandId")
  @ApiDevicesOperation("Read a device command", { responseType: DeviceCommandDto })
  getCommand(@Req() req: RequestWithSession, @Param("deviceId") id: string, @Param("commandId") commandId: string) {
    return this.devices.getCommand(actor(req), id, commandId);
  }

  @Post("me/devices/:deviceId/transfers")
  @ApiDevicesOperation("Create or resume a device transfer", { status: 202, additionalSuccess: [200], body: true, responseType: DeviceTransferDto })
  async transfer(@Req() req: RequestWithSession, @Param("deviceId") id: string, @Body() body: DeviceLooseBodyDto, @Res() res: Response) {
    const out = await this.devices.createTransfer(actor(req), id, { ...body }, getRequestId(req));
    res.status(out.status).json(out.body);
  }

  @Get("me/devices/:deviceId/transfers/:transferId")
  @ApiDevicesOperation("Read device transfer metadata", { responseType: DeviceTransferDto })
  getTransfer(@Req() req: RequestWithSession, @Param("deviceId") id: string, @Param("transferId") transferId: string) {
    return this.devices.getTransfer(actor(req), id, transferId);
  }

  @Get("me/devices/:deviceId/incidents")
  @ApiDevicesOperation("List device incidents", { responseType: DeviceIncidentListDto })
  incidents(@Req() req: RequestWithSession, @Param("deviceId") id: string) {
    return this.devices.listIncidents(actor(req), id);
  }

  @Post("me/devices/:deviceId/incidents/:incidentId/acknowledge")
  @ApiDevicesOperation("Acknowledge a device incident", { responseType: DeviceIncidentEnvelopeDto })
  acknowledge(@Req() req: RequestWithSession, @Param("deviceId") id: string, @Param("incidentId") incidentId: string) {
    return this.devices.acknowledgeIncident(actor(req), id, incidentId);
  }

  @Post("me/devices/:deviceId/incidents/:incidentId/resolve")
  @ApiDevicesOperation("Resolve a device incident", { responseType: DeviceIncidentEnvelopeDto })
  resolve(@Req() req: RequestWithSession, @Param("deviceId") id: string, @Param("incidentId") incidentId: string) {
    return this.devices.resolveIncident(actor(req), id, incidentId);
  }

  @Post("me/devices/:deviceId/profile-transfers")
  @ApiDevicesOperation("Stage a slicer profile for relay delivery", { status: 202, body: true, responseType: DeviceProfileTransferDto })
  async profileTransfer(@Req() req: RequestWithSession, @Param("deviceId") id: string, @Body() body: DeviceLooseBodyDto, @Res() res: Response) {
    const out = await this.devices.transferProfile(actor(req), id, { ...body }, { requestId: getRequestId(req), request: req });
    res.status(out.status).json(out.body);
  }

  @Post("me/devices/:deviceId/print-requests")
  @ApiDevicesOperation("Create an idempotent device print request", { status: 202, additionalSuccess: [200], body: true, responseType: DevicePrintRequestDto })
  async print(@Req() req: RequestWithSession, @Param("deviceId") id: string, @Body() body: DeviceLooseBodyDto, @Headers("idempotency-key") key: unknown, @Res() res: Response) {
    const out = await this.devices.createPrintRequest(actor(req), id, { ...body }, key, { requestId: getRequestId(req), request: req });
    res.status(out.status).json(out.body);
  }

  @Get("me/devices/:deviceId/print-requests/:id")
  @ApiDevicesOperation("Read a device print request", { responseType: DevicePrintRequestDto })
  printStatus(@Req() req: RequestWithSession, @Param("deviceId") deviceId: string, @Param("id") id: string) {
    return this.devices.getPrintRequest(actor(req), deviceId, id);
  }

  @Post("me/devices/:deviceId/print-requests/:id/confirm-start")
  @ApiDevicesOperation("Confirm starting a delivered print", { status: 202, additionalSuccess: [200], responseType: DevicePrintRequestDto })
  async confirm(@Req() req: RequestWithSession, @Param("deviceId") deviceId: string, @Param("id") id: string, @Res() res: Response) {
    const out = await this.devices.confirmPrintStart(actor(req), deviceId, id, getRequestId(req));
    res.status(out.status).json(out.body);
  }
}
