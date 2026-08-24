import { createHash, randomUUID } from "node:crypto";
import { BadRequestException, ConflictException, ForbiddenException, HttpException, Inject, Injectable, NotFoundException, UnauthorizedException } from "@nestjs/common";
import { DeviceId, UserId, type DeviceId as DeviceIdType, type UserId as UserIdType } from "../../_kernel/brandedIds.ts";
import { PROFILE_READ_PORT, type ProfileReadPort } from "../../profile/public/index.ts";
import type { OwnedUserPrinter } from "../../printers/public/index.ts";
import {
  DEVICE_EXTERNAL_PORT,
  type DeviceExternalPort,
  type DeviceLiveState,
  type DeviceOperatingState,
  type DeviceProfileCommandStatus,
  type DeviceProfileOperationsPort,
  type DevicePublicApiOperationsPort,
  type DeviceQueuedProfileCommand,
  type DeviceRequestContext,
  type DevicesPort,
} from "../public/index.ts";
import {
  BEST_EFFORT_DISCLAIMER,
  DEVICE_CONTROL_COMMANDS,
  DEVICE_SHARE_ROLES,
  MAX_DEVICE_TRANSFER_SIZE_BYTES,
  isFirmwareClass,
  isUuid,
  sanitizeFileNameBase,
  type DeviceControlCommand,
  type DeviceShareRole,
} from "../domain/devices.ts";
import {
  DevicesRepository,
  type CommandRow,
  type IncidentRow,
  type PrintRequestRow,
  type ProfileCommandRow,
  type PublicDeviceStateRow,
  type TransferRow,
} from "../infrastructure/devices.repository.ts";

const PUBLIC_TELEMETRY_LIMIT = 500;
const PUBLIC_TELEMETRY_DEFAULT = 100;
const PUBLIC_IDEMPOTENCY_KEY_MAX = 128;
const PUBLIC_GCODE_MAX = 4000;

function fail(status: number): never {
  throw new HttpException({}, status);
}
function deviceId(raw: string): DeviceIdType {
  if (!isUuid(raw)) throw new NotFoundException();
  return DeviceId(raw);
}
function requireIdempotencyKey(value: unknown): string {
  if (typeof value !== "string" || !value || value.length > PUBLIC_IDEMPOTENCY_KEY_MAX) throw new BadRequestException();
  return value;
}
function publicQueuedCommand(row: ProfileCommandRow) {
  return {
    status: 202 as const,
    body: {
      id: row.id,
      correlation_id: row.correlation_id,
      device_id: row.device_id,
      command: row.command,
      status: "queued" as const,
      created_at: row.created_at.toISOString(),
    },
  };
}
function incident(row: IncidentRow) {
  return {
    id: row.id,
    device_id: row.device_id,
    thread_id: row.thread_id,
    event_type: row.event_type,
    severity: row.severity,
    status: row.status,
    occurrence_count: Number(row.occurrence_count),
    first_seen_at: row.first_seen_at.toISOString(),
    last_seen_at: row.last_seen_at.toISOString(),
    acknowledged_at: row.acknowledged_at?.toISOString() ?? null,
    resolved_at: row.resolved_at?.toISOString() ?? null,
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
  };
}
function command(row: CommandRow) {
  return {
    command_id: row.id,
    correlation_id: row.correlation_id,
    device_id: row.device_id,
    command: row.command,
    seq: Number(row.command_seq),
    status: row.status,
    result: row.result,
    error_code: typeof row.result?.error_code === "string" ? row.result.error_code : null,
    error_message: typeof row.result?.message === "string" ? row.result.message : null,
    created_at: row.created_at.toISOString(),
    acked_at: row.acked_at?.toISOString() ?? null,
  };
}
function transfer(row: TransferRow) {
  return {
    transfer_id: row.id,
    device_id: row.device_id,
    file_name: row.file_name,
    size_bytes: Number(row.size_bytes),
    sha256: row.sha256,
    start_print: row.start_print,
    kind: row.kind,
    status: row.status,
    next_seq: Number(row.next_seq),
    bytes_transferred: Number(row.bytes_transferred),
    error_code: row.error_code,
    error_message: row.error_message,
    updated_at: row.updated_at.toISOString(),
  };
}
function print(row: PrintRequestRow) {
  return {
    id: row.id,
    device_id: row.device_id,
    slice_job_id: row.slice_job_id,
    copies: row.copies,
    status: row.status,
    gcode_sha256: row.gcode_sha256,
    transfer_id: row.id,
    start_command_id: row.start_command_id,
    error_code: row.error_code,
    error_message: row.error_message,
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
  };
}
function publicPrinter(printer: OwnedUserPrinter, state: PublicDeviceStateRow | null) {
  return {
    id: printer.id,
    brand: printer.brand,
    model: printer.model,
    connector_type: printer.firmware_class ?? null,
    state: state?.status ?? "offline",
    progress: state?.progress === null || state?.progress === undefined ? null : Number(state.progress),
    job_id: state?.job_id ?? null,
    metrics: state?.metrics ?? {},
    state_updated_at: state?.updated_at?.toISOString() ?? null,
    last_seen_at: printer.last_seen_at?.toISOString() ?? null,
  };
}

@Injectable()
export class DevicesService implements DevicesPort, DeviceProfileOperationsPort, DevicePublicApiOperationsPort {
  constructor(
    @Inject(DevicesRepository) private readonly repository: DevicesRepository,
    @Inject(DEVICE_EXTERNAL_PORT) private readonly external: DeviceExternalPort,
    @Inject(PROFILE_READ_PORT) private readonly profiles: ProfileReadPort,
  ) {}

  async createEnrollCode(actorId: UserIdType, body: Record<string, unknown>) {
    const firmwareClass = isFirmwareClass(body.firmware_class) ? body.firmware_class : null;
    if (body.firmware_class !== undefined && firmwareClass === null) throw new BadRequestException();
    const rawDeviceId = typeof body.device_id === "string" ? body.device_id : null;
    const id = rawDeviceId === null ? null : deviceId(rawDeviceId);
    try {
      const created = await this.repository.createEnrollCode(actorId, {
        firmwareClass,
        label: typeof body.label === "string" ? body.label.trim().slice(0, 128) || null : null,
        deviceId: id,
      });
      const apiUrl = this.external.apiBaseUrl();
      return {
        status: 201,
        body: {
          id: created.id,
          code: created.code,
          expires_at: created.expiresAt.toISOString(),
          install_command: `curl -fsSL ${apiUrl}/devices/agent/install.sh | MULTICA_ENROLL_CODE=${created.code} bash`,
          docker_command: `docker run -d --name 3mf-agent --restart unless-stopped -e MULTICA_ENROLL_CODE=${created.code} -e MULTICA_API_URL=${apiUrl} ghcr.io/3mf/agent:stable`,
        },
      };
    } catch (error) {
      if (error instanceof Error && error.message === "recovery_target_not_found") throw new NotFoundException();
      throw error;
    }
  }
  async revokeEnrollCode(actorId: UserIdType, id: string): Promise<void> {
    if (!isUuid(id) || !(await this.repository.revokeEnrollCode(actorId, id))) throw new NotFoundException();
  }
  async revokeDevice(actorId: UserIdType, id: string, reason: unknown, requestId: string) {
    const result = await this.repository.revokeDevice(deviceId(id), actorId, typeof reason === "string" ? reason.trim().slice(0, 256) || null : null, requestId);
    if (result === "not_owner") throw new ForbiddenException();
    if (result === "no_agent") throw new NotFoundException();
    if (result === "already_revoked") throw new ConflictException();
    return { ok: true as const };
  }
  installScript() {
    const apiUrl = this.external.apiBaseUrl();
    return { contentType: "text/x-shellscript; charset=utf-8", body: this.external.buildInstallScript(apiUrl) };
  }
  async enrollAgent(body: Record<string, unknown>, requestId: string, credentialKind: "enrollment" | "recovery" = "enrollment") {
    const code = typeof body.code === "string" ? body.code.trim() : "";
    if (!code || code.length > 128) throw new BadRequestException();
    const version = typeof body.agent_version === "string" ? body.agent_version.trim().slice(0, 32) : undefined;
    const csrPem = typeof body.csr_pem === "string" ? body.csr_pem.trim() : undefined;
    if (body.csr_pem !== undefined && (csrPem === undefined || csrPem.length === 0 || csrPem.length > 16_384)) throw new BadRequestException();
    try {
      const redeemed = await this.repository.redeemEnrollCode(code, version, requestId, this.external, csrPem, credentialKind);
      return {
        status: 201,
        body: {
          agent_id: redeemed.agentId, device_id: redeemed.deviceId, owner_id: redeemed.ownerId,
          ...(redeemed.credential === undefined ? {} : { credential: redeemed.credential }),
          expires_at: redeemed.expiresAt,
          ...(redeemed.certificate === undefined ? {} : {
            version: "device-agent-runtime.v1" as const,
            gateway_id: redeemed.agentId,
            certificate_pem: redeemed.certificate.certificatePem,
            certificate_chain_pem: redeemed.certificate.certificateChainPem,
            ca_bundle_pem: redeemed.certificate.caBundlePem,
            certificate_fingerprint_sha256: redeemed.certificate.fingerprintSha256,
            command_verification: redeemed.certificate.commandVerification,
          }),
        },
      };
    } catch (error) {
      if (error instanceof Error && error.message === "enroll_code_expired") fail(410);
      if (error instanceof Error && error.message === "invalid_or_expired_code") throw new UnauthorizedException();
      if (error instanceof Error && (error.message === "csr_invalid" || error.message === "csr_policy_rejected")) throw new BadRequestException();
      throw error;
    }
  }
  async upsertShare(actorId: UserIdType, id: string, body: Record<string, unknown>) {
    const did = deviceId(id);
    const target = typeof body.user_id === "string" && isUuid(body.user_id) ? UserId(body.user_id) : null;
    if (target === null) throw new BadRequestException();
    if (!DEVICE_SHARE_ROLES.includes(body.role as DeviceShareRole)) throw new BadRequestException();
    const owner = await this.repository.access(did, actorId);
    if (owner?.role !== "owner") throw new NotFoundException();
    if (target === actorId) throw new ConflictException();
    if ((await this.profiles.findById(target)) === null) throw new NotFoundException();
    const saved = await this.repository.upsertShare(did, target, body.role as DeviceShareRole);
    return { status: saved.created ? 201 : 200, body: { share: saved.row } };
  }
  async deleteShare(actorId: UserIdType, id: string, userId: string) {
    const did = deviceId(id);
    if (!isUuid(userId)) throw new NotFoundException();
    const target = UserId(userId);
    const owner = await this.repository.access(did, actorId);
    if (owner?.role !== "owner") throw new NotFoundException();
    if (target === actorId) throw new ConflictException();
    await this.repository.deleteShare(did, target);
    return { ok: true as const };
  }
  async createCommand(actorId: UserIdType, id: string, body: Record<string, unknown>, key: unknown, requestId: string) {
    const did = deviceId(id);
    const access = await this.repository.access(did, actorId);
    if (access === null) throw new NotFoundException();
    if (access.role !== "owner" && access.role !== "operator") throw new ForbiddenException();
    if (!DEVICE_CONTROL_COMMANDS.includes(body.command as (typeof DEVICE_CONTROL_COMMANDS)[number])) throw new BadRequestException();
    const context = await this.repository.commandContext(did);
    if (context === null) throw new NotFoundException();
    const policy = this.external.commandPolicy({ command: body.command as string, ...context });
    if (!policy.allowed) fail(policy.status);
    if (!process.env.COMMAND_TOKEN_SIGNING_PRIVATE_JWK || !process.env.COMMAND_TOKEN_SIGNING_KID || context.agentId === null) fail(501);
    if (!context.agentCertificateFingerprint) fail(409);
    if (key !== undefined && (typeof key !== "string" || !key || key.length > 128)) throw new BadRequestException();
    const made = await this.repository.createCommand({
      deviceId: did,
      actorId,
      role: access.role,
      command: body.command as DeviceControlCommand,
      idempotencyKey: typeof key === "string" ? key : null,
      requestId,
    });
    if (made.conflict) throw new ConflictException();
    const issued = await this.external.issueCommandToken({
      commandId: made.row.id,
      gatewayId: context.agentId,
      ownerId: access.ownerId,
      actorId,
      deviceId: did,
      role: access.role,
      command: made.row.command,
      seq: Number(made.row.command_seq),
    });
    return { ...command(made.row), token: issued.token, token_expires_at: issued.expiresAt.toISOString() };
  }
  async getCommand(actorId: UserIdType, id: string, commandId: string) {
    const did = deviceId(id);
    if (!isUuid(commandId) || (await this.repository.access(did, actorId)) === null) throw new NotFoundException();
    const row = await this.repository.findCommand(did, commandId);
    if (row === null) throw new NotFoundException();
    return command(row);
  }
  async createTransfer(actorId: UserIdType, id: string, body: Record<string, unknown>, requestId: string) {
    const did = deviceId(id);
    const access = await this.repository.access(did, actorId);
    if (access === null) throw new NotFoundException();
    if (access.role !== "owner" && access.role !== "operator") throw new ForbiddenException();
    const transferId = body.transfer_id === undefined ? null : typeof body.transfer_id === "string" && isUuid(body.transfer_id) ? body.transfer_id : "";
    const fileName = typeof body.file_name === "string" ? body.file_name.trim() : "";
    const size = typeof body.size_bytes === "number" && Number.isSafeInteger(body.size_bytes) ? body.size_bytes : 0;
    const sha = body.sha256 === undefined ? null : typeof body.sha256 === "string" && /^[0-9a-f]{64}$/i.test(body.sha256) ? body.sha256.toLowerCase() : null;
    if (
      (body.transfer_id !== undefined && !transferId) ||
      !fileName ||
      fileName.length > 256 ||
      size <= 0 ||
      size > MAX_DEVICE_TRANSFER_SIZE_BYTES ||
      (body.sha256 !== undefined && !sha)
    )
      throw new BadRequestException();
    const made = await this.repository.createTransfer({
      transferId: transferId || null,
      deviceId: did,
      actorId,
      fileName,
      sizeBytes: size,
      sha256: sha,
      startPrint: body.start_print === true,
      requestId,
    });
    if (made.conflict) throw new ConflictException();
    const meta = transfer(made.row);
    return {
      status: made.resumed ? 200 : 202,
      body: {
        ...meta,
        data_plane: {
          protocol: "relay.file.v1",
          transfer_id: meta.transfer_id,
          file_name: meta.file_name,
          size_bytes: meta.size_bytes,
          sha256: meta.sha256,
          start_print: meta.start_print,
          next_seq: meta.next_seq,
        },
      },
    };
  }
  async getTransfer(actorId: UserIdType, id: string, transferId: string) {
    const did = deviceId(id);
    if (!isUuid(transferId) || (await this.repository.access(did, actorId)) === null) throw new NotFoundException();
    const row = await this.repository.findTransfer(did, transferId);
    if (row === null) throw new NotFoundException();
    return transfer(row);
  }
  async listIncidents(actorId: UserIdType, id: string) {
    const did = deviceId(id);
    if ((await this.repository.access(did, actorId)) === null) throw new NotFoundException();
    return { items: (await this.repository.listIncidents(did)).map(incident) };
  }
  async transition(actorId: UserIdType, id: string, incidentId: string, next: "acknowledged" | "resolved") {
    const did = deviceId(id);
    if (!isUuid(incidentId)) throw new NotFoundException();
    const access = await this.repository.access(did, actorId);
    if (access === null) throw new NotFoundException();
    if (access.role !== "owner" && access.role !== "operator") throw new ForbiddenException();
    const result = await this.repository.transitionIncident(did, incidentId, actorId, next, this.external);
    if (result.kind === "not_found") throw new NotFoundException();
    if (result.kind === "already_resolved") throw new ConflictException();
    if (!("row" in result)) throw new Error("incident transition missing row");
    return { incident: incident(result.row) };
  }
  acknowledgeIncident(actorId: UserIdType, id: string, incidentId: string) {
    return this.transition(actorId, id, incidentId, "acknowledged");
  }
  resolveIncident(actorId: UserIdType, id: string, incidentId: string) {
    return this.transition(actorId, id, incidentId, "resolved");
  }
  async transferProfile(actorId: UserIdType, id: string, body: Record<string, unknown>, context: DeviceRequestContext) {
    const did = deviceId(id);
    const access = await this.repository.access(did, actorId);
    if (access === null) throw new NotFoundException();
    if (access.role !== "owner" && access.role !== "operator") throw new ForbiddenException();
    const profileId = typeof body.profile_id === "string" && isUuid(body.profile_id) ? body.profile_id : null;
    if (profileId === null) throw new BadRequestException();
    const device = await this.repository.commandContext(did);
    if (device === null) throw new NotFoundException();
    const policy = this.external.commandPolicy({ command: "gcode", ...device });
    if (!policy.allowed) fail(policy.status);
    const resolved = await this.external.resolveProfile(profileId);
    if (!resolved.ok) fail(resolved.status);
    const data = Buffer.from(resolved.ini, "utf8");
    const sha256 = createHash("sha256").update(data).digest("hex");
    const fileName = `${sanitizeFileNameBase(resolved.name)}.ini`;
    const transferId = randomUUID();
    await this.repository.createProfileTransfer({ transferId, deviceId: did, actorId, fileName, sizeBytes: data.length, sha256, profileId, requestId: context.requestId });
    const delivery = await this.external.stageTransfer({
      ownerId: access.ownerId,
      deviceId: did,
      transferId,
      fileName,
      sizeBytes: data.length,
      sha256,
      startPrint: false,
      kind: "printer_profile",
      data,
    });
    if (delivery.ok) {
      await this.repository.markTransferSourceReady({ transferId, objectKey: delivery.objectKey, objectVersion: delivery.objectVersion, contentType: delivery.contentType });
      return {
        status: 202,
        body: { transfer_id: transferId, status: "initiated" as const, file_name: fileName, profile_id: profileId, disclaimer: BEST_EFFORT_DISCLAIMER },
      };
    }
    const error = delivery.error.slice(0, 64);
    await this.repository.finishTransfer(transferId, { error, message: null }, did, actorId, context.requestId);
    fail(delivery.status);
  }
  async createPrintRequest(actorId: UserIdType, id: string, body: Record<string, unknown>, key: unknown, context: DeviceRequestContext) {
    await this.external.assertPrintRequestRateLimit(context.request, actorId);
    const did = deviceId(id);
    const access = await this.repository.access(did, actorId);
    if (access === null) throw new NotFoundException();
    if (access.role !== "owner" && access.role !== "operator") throw new ForbiddenException();
    if (typeof key !== "string" || !key || key.length > 128) throw new BadRequestException();
    const sliceId = typeof body.slice_job_id === "string" && isUuid(body.slice_job_id) ? body.slice_job_id : null;
    if (sliceId === null) throw new BadRequestException();
    const copies = body.copies === undefined ? 1 : body.copies;
    if (copies !== 1) throw new BadRequestException();
    const existing = await this.repository.findPrintRequest(did, actorId, { key });
    if (existing !== null) {
      if (existing.slice_job_id !== sliceId || existing.copies !== copies) throw new ConflictException();
      if (existing.status !== "slice_ready") return { status: 200, body: print(existing) };
    }
    const slice = await this.external.loadDispatchableSlice({ sliceJobId: sliceId, actorId });
    if (!slice.ok) fail(slice.status);
    if (slice.job.device_id !== did) throw new ConflictException();
    const device = await this.repository.commandContext(did);
    if (device === null) throw new NotFoundException();
    const policy = this.external.commandPolicy({ command: "gcode", ...device });
    if (!policy.allowed) fail(policy.status);
    if (typeof device.deviceStatus !== "string" || !(device.deviceStatus === "ready" || device.deviceStatus === "idle")) throw new ConflictException();
    if (!device.configFingerprint || device.configFingerprint !== slice.job.slice_trust_material.config_fingerprint) throw new ConflictException();
    const compat = await this.external.evaluateSliceCompat(device, slice.job);
    if (compat.verdict === "blocked") throw new ConflictException();
    let row = existing ?? (await this.repository.insertPrintRequest({ deviceId: did, actorId, sliceJobId: sliceId, copies, key }));
    const created = existing === null && row !== null;
    if (row === null) {
      row = await this.repository.findPrintRequest(did, actorId, { key });
      if (row === null) throw new Error("print_request_insert_failed");
      if (row.status !== "slice_ready") return { status: 200, body: print(row) };
    }
    if (created) await this.repository.audit(did, actorId, "print_request.created", { print_request_id: row.id, slice_job_id: sliceId, request_id: context.requestId });
    const data = await this.external.loadObject(slice.job.gcode_s3_key);
    if (data === null) {
      await this.repository.updatePrintRequest(row.id, { status: "failed", error: "gcode_missing" });
      fail(502);
    }
    const sha = createHash("sha256").update(data).digest("hex");
    const transfer = await this.repository.createTransfer({
      transferId: row.id,
      deviceId: did,
      actorId,
      fileName: `${row.id}.gcode`,
      sizeBytes: data.length,
      sha256: sha,
      startPrint: false,
      requestId: context.requestId,
    });
    if (transfer.conflict) throw new ConflictException();
    const delivery = await this.external.stageTransfer({
      ownerId: access.ownerId,
      deviceId: did,
      transferId: row.id,
      fileName: `${row.id}.gcode`,
      sizeBytes: data.length,
      sha256: sha,
      startPrint: false,
      kind: "gcode",
      data,
    });
    if (delivery.ok) {
      await this.repository.markTransferSourceReady({
        transferId: row.id,
        objectKey: delivery.objectKey,
        objectVersion: delivery.objectVersion,
        contentType: delivery.contentType,
      });
      row = await this.repository.updatePrintRequest(row.id, { status: "slice_ready", sha });
      await this.repository.audit(did, actorId, "print_request.transfer_staged", {
        print_request_id: row.id,
        gcode_sha256: sha,
        object_version: delivery.objectVersion,
        request_id: context.requestId,
      });
      return { status: 202, body: print(row) };
    }
    const error = delivery.error.slice(0, 64);
    await this.repository.updatePrintRequest(row.id, { status: "failed", sha, error, message: null });
    fail(delivery.status);
  }
  async getPrintRequest(actorId: UserIdType, id: string, printId: string) {
    const did = deviceId(id);
    if (!isUuid(printId) || (await this.repository.access(did, actorId)) === null) throw new NotFoundException();
    const row = await this.repository.findPrintRequest(did, null, { id: printId });
    if (row === null) throw new NotFoundException();
    return print(row);
  }
  async confirmPrintStart(actorId: UserIdType, id: string, printId: string, requestId: string) {
    const did = deviceId(id);
    if (!isUuid(printId)) throw new NotFoundException();
    const access = await this.repository.access(did, actorId);
    if (access === null) throw new NotFoundException();
    if (access.role !== "owner" && access.role !== "operator") throw new ForbiddenException();
    const row = await this.repository.findPrintRequest(did, null, { id: printId });
    if (row === null) throw new NotFoundException();
    if (["accepted", "printing", "failed", "rejected"].includes(row.status)) return { status: 200, body: print(row) };
    if (row.status !== "awaiting_confirmation") throw new ConflictException();
    const device = await this.repository.commandContext(did);
    if (device === null) throw new NotFoundException();
    const policy = this.external.commandPolicy({ command: "start", ...device });
    if (!policy.allowed) fail(policy.status);
    if (!process.env.COMMAND_TOKEN_SIGNING_PRIVATE_JWK || !process.env.COMMAND_TOKEN_SIGNING_KID || device.agentId === null) fail(501);
    if (!device.agentCertificateFingerprint) fail(409);
    if (typeof device.deviceStatus !== "string" || !(device.deviceStatus === "ready" || device.deviceStatus === "idle")) throw new ConflictException();
    const commandRow = await this.repository.confirmPrint({ row, deviceId: did, actorId, role: access.role });
    await this.repository.audit(did, actorId, "print_request.confirmed", { print_request_id: row.id, command_id: commandRow.id, request_id: requestId });
    const issued = await this.external.issueCommandToken({
      commandId: commandRow.id,
      gatewayId: device.agentId,
      ownerId: access.ownerId,
      actorId,
      deviceId: did,
      role: access.role,
      command: "start",
      seq: Number(commandRow.command_seq),
    });
    const updated = await this.repository.findPrintRequest(did, null, { id: printId });
    return { status: 202, body: { ...print(updated!), token: issued.token, token_expires_at: issued.expiresAt.toISOString() } };
  }
  async operatingState(printerId: string): Promise<DeviceOperatingState> {
    const raw = await this.repository.operatingRow(deviceId(printerId));
    if (raw === null) throw new NotFoundException();
    const operating = this.external.resolveOperatingState(raw);
    return {
      state: raw.state_status ?? null,
      progress: raw.progress === null ? null : Number(raw.progress),
      job_id: raw.job_id ?? null,
      metrics: raw.metrics,
      seq: raw.seq,
      last_seen_at: raw.last_seen_at,
      ...operating,
    };
  }
  async liveState(printerId: string): Promise<DeviceLiveState> {
    const raw = await this.repository.operatingRow(deviceId(printerId));
    if (raw === null) throw new NotFoundException();
    const operating = this.external.resolveOperatingState(raw);
    return {
      live: operating.live_availability_reason === "available",
      state: raw.state_status ?? "offline",
      progress: raw.progress === null ? null : Number(raw.progress),
      metrics: raw.metrics,
      job_id: raw.job_id ?? null,
      state_updated_at: raw.state_updated_at instanceof Date ? raw.state_updated_at.toISOString() : (raw.state_updated_at ?? null),
      last_seen_at: raw.last_seen_at?.toISOString() ?? null,
      seq: raw.seq,
      ...operating,
    };
  }
  async queueCommand(
    printerId: string,
    userId: UserIdType,
    key: string,
    input: { command: string; slice_id?: string; file_name?: string },
    requestId: string,
  ): Promise<DeviceQueuedProfileCommand> {
    const did = deviceId(printerId);
    if (input.command === "format" || input.command === "delete") throw new ForbiddenException();
    if (!["gcode", "start", "pause", "stop"].includes(input.command)) throw new BadRequestException();
    const payload: Record<string, unknown> = {};
    const sliceId = input.command === "gcode" ? input.slice_id : undefined;
    if (input.command === "gcode") {
      if (typeof sliceId !== "string" || !isUuid(sliceId)) throw new BadRequestException();
      payload.slice_id = sliceId;
    }
    if (input.command === "start" && typeof input.file_name === "string") payload.file_name = input.file_name.slice(0, 256);
    const existing = await this.repository.findProfileCommand(did, userId, key);
    if (existing !== null) {
      if (existing.command !== input.command || JSON.stringify(existing.payload) !== JSON.stringify(payload)) throw new ConflictException();
      return {
        id: existing.id,
        correlation_id: existing.correlation_id,
        device_id: did,
        command: existing.command,
        status: "queued",
        created_at: existing.created_at.toISOString(),
      };
    }
    const context = await this.repository.commandContext(did);
    if (context === null) throw new NotFoundException();
    const policy = this.external.commandPolicy({ command: input.command, ...context });
    if (!policy.allowed) fail(policy.status);
    if (sliceId !== undefined) {
      const slice = await this.external.loadDispatchableSlice({ sliceJobId: sliceId, actorId: userId });
      if (!slice.ok) fail(slice.status);
      if (slice.job.device_id !== did || context.configFingerprint !== slice.job.slice_trust_material.config_fingerprint) throw new ConflictException();
      payload.slice_id = slice.job.id;
    }
    const made = await this.repository.queueIdempotentCommand({ deviceId: did, actorId: userId, idempotencyKey: key, command: input.command, payload, requestId });
    if (made.conflict) throw new ConflictException();
    return {
      id: made.row.id,
      correlation_id: made.row.correlation_id,
      device_id: did,
      command: made.row.command,
      status: "queued",
      created_at: made.row.created_at.toISOString(),
    };
  }
  async commandStatus(printerId: string, commandId: string): Promise<DeviceProfileCommandStatus | null> {
    const did = deviceId(printerId);
    const row = await this.repository.findProfileCommandById(did, commandId);
    if (row === null) return null;
    return {
      ...this.external.normalizeCommandResult({
        id: row.id,
        correlation_id: row.correlation_id,
        raw_status: row.status,
        result: row.result,
        created_at: row.created_at,
        acked_at: row.acked_at,
      }),
      device_id: row.device_id,
      command: row.command,
      raw_status: row.status,
      created_at: row.created_at.toISOString(),
      acked_at: row.acked_at?.toISOString() ?? null,
    };
  }

  async publicListPrinters(ownerId: UserIdType) {
    return { printers: (await this.repository.publicPrinters(ownerId)).map(({ printer, state }) => publicPrinter(printer, state)) };
  }

  async publicPrinter(ownerId: UserIdType, rawDeviceId: string) {
    const did = deviceId(rawDeviceId);
    if ((await this.repository.access(did, ownerId)) === null) throw new NotFoundException();
    const row = await this.repository.publicPrinter(did);
    if (row === null) throw new NotFoundException();
    return publicPrinter(row.printer, row.state);
  }

  async publicTelemetry(ownerId: UserIdType, rawDeviceId: string, query: { readonly limit?: string; readonly since?: string }) {
    const did = deviceId(rawDeviceId);
    if ((await this.repository.access(did, ownerId)) === null) throw new NotFoundException();
    const limit = Math.min(PUBLIC_TELEMETRY_LIMIT, Math.max(1, Number(query.limit) || PUBLIC_TELEMETRY_DEFAULT));
    const since = query.since !== undefined && !Number.isNaN(Date.parse(query.since)) ? query.since : null;
    return {
      telemetry: (await this.repository.publicTelemetry(did, since, limit)).map((row) => ({
        recorded_at: row.recorded_at.toISOString(),
        status: row.status,
        progress: row.progress === null ? null : Number(row.progress),
        metrics: row.metrics ?? {},
      })),
    };
  }

  async publicTestJobCommand(ownerId: UserIdType, rawDeviceId: string, body: Readonly<Record<string, unknown>>, idempotencyKey: unknown, requestId: string) {
    const did = deviceId(rawDeviceId);
    const access = await this.repository.access(did, ownerId);
    if (access === null) throw new NotFoundException();
    if (access.role !== "owner" && access.role !== "operator") throw new ForbiddenException();
    const rawCommand = typeof body.command === "string" ? body.command : "";
    const safe = this.external.evaluateSafeTestJob({ command: rawCommand, safeTestJob: body.safe_test_job === true });
    if (!safe.allowed) fail(safe.status);
    if (rawCommand === "query") {
      const state = await this.repository.publicDeviceState(did);
      if (state === null) throw new NotFoundException();
      return {
        status: 200,
        body: {
          device_id: did,
          command: rawCommand,
          result: { state: state.status ?? "offline", progress: state.progress === null ? null : Number(state.progress), job_id: state.job_id },
        },
      };
    }
    const key = requireIdempotencyKey(idempotencyKey);
    const existing = await this.repository.findProfileCommand(did, ownerId, key);
    if (existing !== null) {
      if (existing.command !== rawCommand || JSON.stringify(existing.payload) !== "{}") throw new ConflictException();
      return publicQueuedCommand(existing);
    }
    const context = await this.repository.commandContext(did);
    if (context === null) throw new NotFoundException();
    const policy = this.external.commandPolicy({ command: rawCommand, ...context });
    if (!policy.allowed) fail(policy.status);
    return this.queuePublicApiCommand(did, ownerId, rawCommand, {}, key, requestId);
  }

  async publicCommand(ownerId: UserIdType, rawDeviceId: string, body: Readonly<Record<string, unknown>>, idempotencyKey: unknown, requestId: string, hasControlScope: boolean) {
    const did = deviceId(rawDeviceId);
    const access = await this.repository.access(did, ownerId);
    if (access === null) throw new NotFoundException();
    if (access.role !== "owner" && access.role !== "operator") {
      await this.repository.audit(did, ownerId, "access.denied", { action: "command", reason: `role:${access.role}`, request_id: requestId });
      throw new ForbiddenException();
    }
    const rawCommand = typeof body.command === "string" ? body.command : "";
    const policy = this.external.evaluatePublicCommand({ command: rawCommand, deviceId: did, role: access.role, hasControlScope });
    if (!policy.allowed) {
      if (policy.status === 403)
        await this.repository.audit(did, ownerId, "command.denied", { command: rawCommand, reason: policy.error, request_id: requestId, correlation_id: randomUUID() });
      fail(policy.status);
    }
    const payload: Record<string, unknown> = {};
    if (rawCommand === "gcode") {
      const script = typeof body.script === "string" ? body.script : "";
      if (!script || script.length > PUBLIC_GCODE_MAX) throw new BadRequestException();
      payload.script = script;
    }
    if (rawCommand === "start" && typeof body.file_name === "string") payload.file_name = body.file_name.slice(0, 256);
    const key = requireIdempotencyKey(idempotencyKey);
    const existing = await this.repository.findProfileCommand(did, ownerId, key);
    if (existing !== null) {
      if (existing.command !== rawCommand || JSON.stringify(existing.payload) !== JSON.stringify(payload)) throw new ConflictException();
      return publicQueuedCommand(existing);
    }
    const context = await this.repository.commandContext(did);
    if (context === null) throw new NotFoundException();
    const printerPolicy = this.external.commandPolicy({ command: rawCommand, ...context });
    if (!printerPolicy.allowed) fail(printerPolicy.status);
    return this.queuePublicApiCommand(did, ownerId, rawCommand, payload, key, requestId);
  }

  private async queuePublicApiCommand(
    deviceIdValue: DeviceIdType,
    ownerId: UserIdType,
    publicCommandValue: string,
    payload: Readonly<Record<string, unknown>>,
    idempotencyKey: string,
    requestId: string,
  ) {
    const made = await this.repository.queueIdempotentCommand({ deviceId: deviceIdValue, actorId: ownerId, idempotencyKey, command: publicCommandValue, payload, requestId });
    if (made.conflict) throw new ConflictException();
    return publicQueuedCommand(made.row);
  }

  async publicCommandStatus(ownerId: UserIdType, rawDeviceId: string, commandId: string) {
    const did = deviceId(rawDeviceId);
    if (!isUuid(commandId) || (await this.repository.access(did, ownerId)) === null) throw new NotFoundException();
    const row = await this.repository.findProfileCommandById(did, commandId);
    if (row === null) throw new NotFoundException();
    const normalized = this.external.normalizeCommandResult({
      id: row.id,
      correlation_id: row.correlation_id,
      raw_status: row.status,
      result: row.result,
      created_at: row.created_at,
      acked_at: row.acked_at,
    });
    return {
      id: row.id,
      correlation_id: row.correlation_id,
      device_id: did,
      command: row.command,
      status: normalized.status,
      result: row.result,
      created_at: row.created_at.toISOString(),
      acked_at: row.acked_at?.toISOString() ?? null,
    };
  }
}
