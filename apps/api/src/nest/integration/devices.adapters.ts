import { Global, Inject, Injectable, Module } from "@nestjs/common";
import type { Request } from "express";
import { apiBaseUrl } from "../../modules/seo/public/index.ts";
import { buildInstallScript, issueAgentCredential, issueCommandToken, issueGatewayCertificate, stageDeviceTransfer } from "../../modules/devices/public/index.ts";
import { evaluatePrinterCommand, printerCommandPolicyStatus } from "../../modules/printers/public/index.ts";
import { getModelObjectStream } from "../../storage/s3.ts";
import { compatCheck, MODEL_READ_PORT, type CompatFilamentInput, type CompatModelInput, type CompatPrinterInput, type ModelReadPort } from "../../modules/models/public/index.ts";
import { ModelsModule } from "../../modules/models/models.module.ts";
import { CATALOG_READ_PORT, type CatalogReadPort } from "../../modules/catalog/public/index.ts";
import { CatalogModule } from "../../modules/catalog/catalog.module.ts";
import { SLICER_PROFILES_PORT, type SlicerProfilesPort } from "../../modules/slicerProfiles/public/index.ts";
import { SlicerProfilesModule } from "../../modules/slicerProfiles/slicerProfiles.module.ts";
import { SlicerProfileId } from "../../modules/slicerProfiles/public/index.ts";
import { assertNestRateLimit } from "./rate-limit.ts";
import { resolveOperatingState } from "../../modules/profile/public/legacy.ts";
import { DEVICE_COMMAND_ALLOWLIST, evaluateCommand, evaluateSafeTestJobCommand, isKnownCommand, normalizeCommandResult } from "../../modules/devices/public/index.ts";
import { DEVICE_EXTERNAL_PORT, DEVICE_INCIDENT_EVENT_WRITE_PORT, type DeviceExternalPort, type DeviceIncidentEventWritePort } from "../../modules/devices/public/index.ts";
import { DevicesModule } from "../../modules/devices/devices.module.ts";
import { ASSISTANT_INCIDENT_PORT, type AssistantIncidentPort } from "../../modules/assistant/public/index.ts";
import { AssistantModule } from "../../modules/assistant/assistant.module.ts";
import type { DeviceId, UserId } from "../../modules/_kernel/brandedIds.ts";
import type { PrinterQueryExecutor } from "../../modules/printers/public/index.ts";

@Injectable()
export class DeviceExternalAdapter implements DeviceExternalPort {
  constructor(
    @Inject(MODEL_READ_PORT) private readonly models: ModelReadPort,
    @Inject(CATALOG_READ_PORT) private readonly catalog: CatalogReadPort,
    @Inject(SLICER_PROFILES_PORT) private readonly slicerProfiles: SlicerProfilesPort,
    @Inject(ASSISTANT_INCIDENT_PORT) private readonly assistantIncidents: AssistantIncidentPort,
    @Inject(DEVICE_INCIDENT_EVENT_WRITE_PORT) private readonly incidentEvents: DeviceIncidentEventWritePort,
  ) {}
  apiBaseUrl(): string {
    return apiBaseUrl();
  }
  buildInstallScript(value: string): string {
    return buildInstallScript(value);
  }
  issueAgentCredential(input: { agentId: string; ownerId: UserId; deviceId: DeviceId }): Promise<string> {
    return issueAgentCredential({ ...input, role: "owner" });
  }
  issueCommandToken(input: Parameters<DeviceExternalPort["issueCommandToken"]>[0]) {
    return issueCommandToken(input);
  }
  issueGatewayCertificate(csrPem: string, gatewayId: string) {
    return issueGatewayCertificate(csrPem, gatewayId);
  }
  assertPrintRequestRateLimit(request: Request, userId: UserId): Promise<void> {
    return assertNestRateLimit(request, "device_print_request_create", userId);
  }
  commandPolicy(input: Record<string, unknown> & { command: string }) {
    const result = evaluatePrinterCommand(input as unknown as Parameters<typeof evaluatePrinterCommand>[0]);
    return result.allowed ? { allowed: true as const } : { allowed: false as const, status: printerCommandPolicyStatus(result.error), error: result.error };
  }
  resolveProfile(profileId: string) {
    return this.slicerProfiles.resolveDeviceProfile(SlicerProfileId(profileId));
  }
  stageTransfer(input: Parameters<DeviceExternalPort["stageTransfer"]>[0]) {
    return stageDeviceTransfer(input);
  }
  async loadDispatchableSlice(input: { sliceJobId: string; actorId: UserId }) {
    const result = await this.models.loadDispatchableSlice(input.sliceJobId, input.actorId);
    if (result.kind === "missing") return { ok: false as const, status: 404, error: "slice_not_found" };
    if (result.kind === "not_ready") return { ok: false as const, status: 409, error: "slice_not_ready" };
    if (result.kind === "untrusted") return { ok: false as const, status: 409, error: "slice_untrusted" };
    return { ok: true as const, job: result.job };
  }
  async evaluateSliceCompat(deviceValue: unknown, jobValue: Record<string, unknown>) {
    const device = deviceValue as { buildVolume: unknown; printerId: string | null };
    const job = jobValue as { filament_profile_id?: string | null; model_id: string };
    const machineSpecs = device.printerId === null ? {} : ((await this.catalog.machineSummary(device.printerId))?.specs ?? {});
    const build = (device.buildVolume as { x: number; y: number; z: number } | null) ??
      (machineSpecs.build_volume as { x: number; y: number; z: number } | undefined) ?? { x: 100000, y: 100000, z: 100000 };
    const printer: CompatPrinterInput = {
      buildVolumeMm: build,
      nozzleHardened: typeof machineSpecs.nozzle_hardened === "boolean" ? machineSpecs.nozzle_hardened : undefined,
      maxHotendTempC: typeof machineSpecs.max_hotend_temp_c === "number" ? machineSpecs.max_hotend_temp_c : undefined,
      chamber: typeof machineSpecs.chamber === "string" ? (machineSpecs.chamber as CompatPrinterInput["chamber"]) : undefined,
      extruderDrive: typeof machineSpecs.extruder_drive === "string" ? (machineSpecs.extruder_drive as CompatPrinterInput["extruderDrive"]) : undefined,
      filamentDiameterMm: typeof machineSpecs.filament_dia_mm === "number" ? machineSpecs.filament_dia_mm : undefined,
    };
    const filament: CompatFilamentInput | undefined = job.filament_profile_id
      ? ((await this.slicerProfiles.compatibilityFilament(SlicerProfileId(job.filament_profile_id))) ?? undefined)
      : undefined;
    const bboxMm = await this.models.boundingBoxByInternalModelId(job.model_id);
    const model: CompatModelInput | undefined = bboxMm === null ? undefined : { bboxMm };
    return compatCheck(printer, filament, model);
  }
  async loadObject(key: string): Promise<Buffer | null> {
    const object = await getModelObjectStream(key);
    if (object === null) return null;
    const chunks: Buffer[] = [];
    for await (const chunk of object.body as AsyncIterable<Buffer>) chunks.push(chunk);
    return Buffer.concat(chunks);
  }
  async transitionIncidentThread(executor: PrinterQueryExecutor, input: { threadId: string; incidentId: string; status: "acknowledged" | "resolved" }): Promise<void> {
    await this.assistantIncidents.transitionIncidentThread(executor, input);
    await this.incidentEvents.appendIncidentThreadEvent(executor, input);
  }
  resolveOperatingState(row: Parameters<DeviceExternalPort["resolveOperatingState"]>[0]) {
    return resolveOperatingState(row);
  }
  normalizeCommandResult(row: Parameters<DeviceExternalPort["normalizeCommandResult"]>[0]) {
    return normalizeCommandResult(row);
  }
  evaluatePublicCommand(input: Parameters<DeviceExternalPort["evaluatePublicCommand"]>[0]) {
    if (!isKnownCommand(input.command)) {
      return { allowed: false as const, status: 400, error: `unknown_command:${DEVICE_COMMAND_ALLOWLIST.join(",")}` };
    }
    const result = evaluateCommand({
      command: input.command,
      deviceId: input.deviceId,
      scopedDeviceId: input.deviceId,
      actorScope: input.hasControlScope ? "control" : undefined,
      actorRole: input.role,
    });
    return result.allowed ? { allowed: true as const } : { allowed: false as const, status: 403, error: result.error };
  }
  evaluateSafeTestJob(input: Parameters<DeviceExternalPort["evaluateSafeTestJob"]>[0]) {
    const result = evaluateSafeTestJobCommand({ command: input.command, safeTestJob: input.safeTestJob });
    return result.allowed ? { allowed: true as const } : { allowed: false as const, status: result.error === "unknown_command" ? 400 : 403, error: result.error };
  }
}

@Global()
@Module({
  imports: [AssistantModule, CatalogModule, DevicesModule, ModelsModule, SlicerProfilesModule],
  providers: [DeviceExternalAdapter, { provide: DEVICE_EXTERNAL_PORT, useExisting: DeviceExternalAdapter }],
  exports: [DEVICE_EXTERNAL_PORT],
})
export class DevicesIntegrationModule {}
