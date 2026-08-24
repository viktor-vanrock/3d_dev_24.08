import type { Request } from "express";
import type { QueryResult, QueryResultRow } from "pg";
import type { CommandVerificationKeySet } from "@portal/contracts/device-agent-runtime/v1";
import type { PrinterQueryExecutor } from "../../printers/public/index.ts";
import type { DeviceId, UserId } from "../../_kernel/brandedIds.ts";

export { verifyAgentCredential, type VerifiedAgentCredential } from "../infrastructure/agent-session.ts";

export const DEVICES_PORT = Symbol("DEVICES_PORT");
export const DEVICE_EXTERNAL_PORT = Symbol("DEVICE_EXTERNAL_PORT");
export const DEVICE_PROFILE_OPERATIONS_PORT = Symbol("DEVICE_PROFILE_OPERATIONS_PORT");
export const DEVICE_PUBLIC_API_OPERATIONS_PORT = Symbol("DEVICE_PUBLIC_API_OPERATIONS_PORT");
export const DEVICE_INCIDENT_EVENT_READ_PORT = Symbol("DEVICE_INCIDENT_EVENT_READ_PORT");
export const DEVICE_INCIDENT_EVENT_WRITE_PORT = Symbol("DEVICE_INCIDENT_EVENT_WRITE_PORT");
export const DEVICE_COMMAND_RELAY_PORT = Symbol("DEVICE_COMMAND_RELAY_PORT");
export const DEVICE_RELAY_CONTROL_PORT = Symbol("DEVICE_RELAY_CONTROL_PORT");
export const DEVICE_ADMIN_PORT = Symbol("DEVICE_ADMIN_PORT");
export const DEVICE_RELAY_PUSH_PORT = Symbol("DEVICE_RELAY_PUSH_PORT");

export type RelayControlCloseReason = "agent_revoked" | "owner_blocked" | "admin_action";

export interface DeviceAdminPort {
  revokeAllActiveByOwner(ownerId: UserId, reason: string, actorId: UserId): Promise<readonly string[]>;
}

export interface DeviceRelayPushPort {
  closeAgentSessions(agentIds: readonly string[], reason: RelayControlCloseReason): Promise<void>;
}

export interface GatewayCertificate {
  readonly certificatePem: string;
  readonly certificateChainPem: readonly string[];
  readonly caBundlePem: readonly string[];
  readonly fingerprintSha256: string;
  readonly expiresAt: string;
  readonly commandVerification: CommandVerificationKeySet;
}

export type RelayCommandDeliveryState = "leased" | "delivered" | "acknowledged";
export type RelayCommandTerminalState = "executed" | "failed";

export interface RelayCommandClaimRow {
  readonly commandId: string;
  readonly deviceId: string;
  readonly commandSeq: number;
  readonly command: "start" | "pause" | "resume" | "cancel";
  readonly fileName: string | null;
  readonly actorId: string;
  readonly actorRole: "owner" | "operator";
  readonly claimOwner: string;
  readonly claimToken: string;
  readonly generation: number;
  readonly attemptCount: number;
  readonly maxAttempts: number;
  readonly leaseExpiresAt: Date;
  readonly expiresAt: Date;
}

export interface RelayCommandLeaseRow {
  readonly commandId: string;
  readonly status: RelayCommandDeliveryState;
  readonly generation: number;
  readonly leaseExpiresAt: Date;
}

export interface RelayCommandTerminalRow {
  readonly commandId: string;
  readonly commandSeq: number;
  readonly status: RelayCommandTerminalState;
  readonly generation: number;
  readonly terminalErrorCode: string | null;
  readonly completedAt: Date;
}

export type RelayCommandResultWrite = { readonly kind: "accepted" | "replayed"; readonly row: RelayCommandTerminalRow } | { readonly kind: "conflict" | "fence_rejected" };

export interface DeviceCommandRelayPort {
  claim(input: {
    readonly claimOwner: string;
    readonly authorizedDeviceIds: readonly string[];
    readonly limit: number;
    readonly operationId?: string;
    readonly requestHash?: string;
  }): Promise<{ readonly commands: readonly RelayCommandClaimRow[]; readonly replayed: boolean }>;
  heartbeat(input: {
    readonly commandId: string;
    readonly claimOwner: string;
    readonly claimToken: string;
    readonly generation: number;
    readonly deliveryState: RelayCommandDeliveryState;
  }): Promise<RelayCommandLeaseRow | null>;
  writeResult(input: {
    readonly commandId: string;
    readonly commandSeq: number;
    readonly claimOwner: string;
    readonly claimToken: string;
    readonly generation: number;
    readonly status: RelayCommandTerminalState;
    readonly errorCode: string | null;
  }): Promise<RelayCommandResultWrite>;
}

export interface DeviceIncidentEvent {
  readonly seq: number;
  readonly event_type: string;
  readonly payload: Record<string, unknown>;
}

export interface DeviceIncidentEventReadPort {
  loadThreadEventsAfter(threadId: string, afterSeq: number): Promise<readonly DeviceIncidentEvent[]>;
}

export interface DeviceQueryExecutor {
  query<R extends QueryResultRow = QueryResultRow>(text: string, values?: readonly unknown[]): Promise<QueryResult<R>>;
}

export interface DeviceIncidentEventWritePort {
  appendIncidentThreadEvent(
    executor: DeviceQueryExecutor,
    input: { readonly threadId: string; readonly incidentId: string; readonly status: "acknowledged" | "resolved" },
  ): Promise<void>;
}

export type DeviceRole = "owner" | "operator" | "viewer" | "guest";

export interface DeviceMetrics {
  readonly [name: string]: string | number | boolean | null;
}
export type DeviceConnectionMode = "list" | "managed-local" | "managed-bridge";
export type DeviceLiveAvailabilityReason = "available" | "no_telemetry_channel" | "offline" | "stale" | "permission_denied" | "server_error";
export interface DeviceOperatingAvailability {
  readonly connection_mode: DeviceConnectionMode;
  readonly live_availability_reason: DeviceLiveAvailabilityReason;
  readonly last_confirmed_at: string | null;
  readonly command_capabilities: Readonly<Record<"gcode" | "start" | "pause" | "resume" | "stop" | "cancel", boolean>>;
}
export interface DeviceOperatingState extends DeviceOperatingAvailability {
  readonly state: string | null;
  readonly progress: number | null;
  readonly job_id: string | null;
  readonly metrics: DeviceMetrics;
  readonly seq: number;
  readonly last_seen_at: Date | null;
}
export interface DeviceLiveState extends DeviceOperatingAvailability {
  readonly live: boolean;
  readonly state: string;
  readonly progress: number | null;
  readonly job_id: string | null;
  readonly metrics: DeviceMetrics;
  readonly seq: number;
  readonly state_updated_at: string | null;
  readonly last_seen_at: string | null;
}
export interface DeviceQueuedProfileCommand {
  readonly id: string;
  readonly correlation_id: string;
  readonly device_id: string;
  readonly command: string;
  readonly status: "queued";
  readonly created_at: string;
}
export interface DeviceProfileCommandStatus {
  readonly command_id: string;
  readonly correlation_id: string;
  readonly device_id: string;
  readonly command: string;
  readonly status: "queued" | "leased" | "delivered" | "acknowledged" | "executed" | "failed" | "expired";
  readonly raw_status: string;
  readonly code: string | null;
  readonly message: string | null;
  readonly timestamp: string;
  readonly created_at: string;
  readonly acked_at: string | null;
}
export interface DeviceOperatingStateInput {
  readonly connection_mode: unknown;
  readonly link_source: unknown;
  readonly agent_id: string | null;
  readonly agent_revoked_at: Date | string | null;
  readonly state_status: string | null;
  readonly state_updated_at: Date | string | null;
  readonly capabilities: unknown;
}
export interface DeviceCommandResult {
  readonly [name: string]: string | boolean | undefined;
  readonly ok?: boolean;
  readonly status?: string;
  readonly error_code?: string;
  readonly code?: string;
  readonly message?: string;
}
export interface DeviceCommandResponse {
  readonly command_id: string;
  readonly correlation_id: string;
  readonly device_id: string;
  readonly command: string;
  readonly seq: number;
  readonly status: string;
  readonly result: DeviceCommandResult | null;
  readonly error_code: string | null;
  readonly error_message: string | null;
  readonly created_at: string;
  readonly acked_at: string | null;
  readonly token?: string;
  readonly token_expires_at?: string;
}
export interface DeviceTransferResponse {
  readonly transfer_id: string;
  readonly device_id: string;
  readonly file_name: string;
  readonly size_bytes: number;
  readonly sha256: string | null;
  readonly start_print: boolean;
  readonly kind: "gcode" | "printer_profile";
  readonly status: string;
  readonly next_seq: number;
  readonly bytes_transferred: number;
  readonly error_code: string | null;
  readonly error_message: string | null;
  readonly updated_at: string;
}
export interface DeviceIncidentResponse {
  readonly id: string;
  readonly device_id: string;
  readonly thread_id: string;
  readonly event_type: string;
  readonly severity: string;
  readonly status: string;
  readonly occurrence_count: number;
  readonly first_seen_at: string;
  readonly last_seen_at: string;
  readonly acknowledged_at: string | null;
  readonly resolved_at: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}
export interface DevicePrintRequestResponse {
  readonly id: string;
  readonly device_id: string;
  readonly slice_job_id: string;
  readonly copies: number;
  readonly status: string;
  readonly gcode_sha256: string | null;
  readonly transfer_id: string;
  readonly start_command_id: string | null;
  readonly error_code: string | null;
  readonly error_message: string | null;
  readonly created_at: string;
  readonly updated_at: string;
  readonly token?: string;
  readonly token_expires_at?: string;
}
export interface PublicPrinterResponse {
  readonly id: string;
  readonly brand: string;
  readonly model: string;
  readonly connector_type: string | null;
  readonly state: string;
  readonly progress: number | null;
  readonly job_id: string | null;
  readonly metrics: DeviceMetrics;
  readonly state_updated_at: string | null;
  readonly last_seen_at: string | null;
}
export interface PublicTelemetryItem {
  readonly recorded_at: string;
  readonly status: string | null;
  readonly progress: number | null;
  readonly metrics: DeviceMetrics;
}
export interface PublicQueuedCommandResponse {
  readonly id: string;
  readonly correlation_id: string;
  readonly device_id: string;
  readonly command: string;
  readonly status: "queued";
  readonly created_at: string;
}
export interface PublicCommandStatusResponse extends Omit<PublicQueuedCommandResponse, "status"> {
  readonly status: "queued" | "leased" | "delivered" | "acknowledged" | "executed" | "failed" | "expired";
  readonly result: DeviceCommandResult | null;
  readonly acked_at: string | null;
}
export interface PublicTestQueryResponse {
  readonly device_id: string;
  readonly command: string;
  readonly result: { readonly state: string; readonly progress: number | null; readonly job_id: string | null };
}
export interface DeviceEnrollCodeResponse {
  readonly id: string;
  readonly code: string;
  readonly expires_at: string;
  readonly install_command: string;
  readonly docker_command: string;
}
export interface DeviceEnrollmentResponse {
  readonly version?: "device-agent-runtime.v1";
  readonly agent_id: string;
  readonly gateway_id?: string;
  readonly device_id: string;
  readonly owner_id: string;
  /** Legacy bootstrap bearer; omitted by CSR enrollment. */
  readonly credential?: string;
  readonly expires_at: string | null;
  readonly certificate_pem?: string;
  readonly certificate_chain_pem?: readonly string[];
  readonly ca_bundle_pem?: readonly string[];
  readonly certificate_fingerprint_sha256?: string;
  readonly command_verification?: CommandVerificationKeySet;
}
export interface DeviceShareResponse {
  readonly id: string;
  readonly device_id: string;
  readonly user_id: string;
  readonly role: string;
  readonly created_at: Date;
  readonly updated_at: Date;
}
export interface DeviceProfileTransferResponse {
  readonly transfer_id: string;
  readonly status: "initiated";
  readonly file_name: string;
  readonly profile_id: string;
  readonly disclaimer: string;
}

export interface DeviceRequestContext {
  readonly requestId: string;
  readonly request: Request;
}

export interface DeviceExternalPort {
  apiBaseUrl(): string;
  buildInstallScript(apiBaseUrl: string): string;
  issueAgentCredential(input: { readonly agentId: string; readonly ownerId: UserId; readonly deviceId: DeviceId }): Promise<string>;
  issueGatewayCertificate(csrPem: string, gatewayId: string): GatewayCertificate;
  issueCommandToken(input: {
    readonly commandId: string;
    readonly gatewayId: string;
    readonly ownerId: UserId;
    readonly actorId: UserId;
    readonly deviceId: DeviceId;
    readonly role: "owner" | "operator";
    readonly command: "pause" | "resume" | "cancel" | "start";
    readonly seq: number;
  }): Promise<{ readonly token: string; readonly expiresAt: Date }>;
  assertPrintRequestRateLimit(request: Request, userId: UserId): Promise<void>;
  commandPolicy(
    input: Record<string, unknown> & { readonly command: string },
  ): { readonly allowed: true } | { readonly allowed: false; readonly status: number; readonly error: string };
  resolveProfile(
    profileId: string,
  ): Promise<{ readonly ok: true; readonly name: string; readonly ini: string } | { readonly ok: false; readonly status: number; readonly error: string }>;
  stageTransfer(input: {
    readonly ownerId: string;
    readonly deviceId: DeviceId;
    readonly transferId: string;
    readonly fileName: string;
    readonly sizeBytes: number;
    readonly sha256: string;
    readonly startPrint: boolean;
    readonly kind: "gcode" | "printer_profile";
    readonly data: Buffer;
  }): Promise<
    | { readonly ok: true; readonly objectKey: string; readonly objectVersion: string; readonly contentType: "model/gcode" | "text/plain" }
    | { readonly ok: false; readonly status: number; readonly error: string }
  >;
  loadDispatchableSlice(input: { readonly sliceJobId: string; readonly actorId: UserId }): Promise<
    | {
        readonly ok: true;
        readonly job: Record<string, unknown> & {
          readonly id: string;
          readonly device_id: string | null;
          readonly gcode_s3_key: string;
          readonly slice_trust_material: { readonly config_fingerprint: string };
        };
      }
    | { readonly ok: false; readonly status: number; readonly error: string }
  >;
  evaluateSliceCompat(device: unknown, job: Record<string, unknown>): Promise<{ readonly verdict: "ok" | "warn" | "blocked"; readonly reasons: readonly unknown[] }>;
  loadObject(key: string): Promise<Buffer | null>;
  transitionIncidentThread(
    executor: PrinterQueryExecutor,
    input: { readonly threadId: string; readonly incidentId: string; readonly status: "acknowledged" | "resolved" },
  ): Promise<void>;
  resolveOperatingState(row: DeviceOperatingStateInput): DeviceOperatingAvailability;
  normalizeCommandResult(row: {
    readonly id: string;
    readonly correlation_id: string;
    readonly raw_status: string;
    readonly result: DeviceCommandResult | null;
    readonly created_at: Date;
    readonly acked_at: Date | null;
  }): Omit<DeviceProfileCommandStatus, "device_id" | "command" | "raw_status" | "created_at" | "acked_at">;
  evaluatePublicCommand(input: {
    readonly command: string;
    readonly deviceId: string;
    readonly role: DeviceRole;
    readonly hasControlScope: boolean;
  }): { readonly allowed: true } | { readonly allowed: false; readonly status: number; readonly error: string };
  evaluateSafeTestJob(input: {
    readonly command: string;
    readonly safeTestJob: boolean;
  }): { readonly allowed: true } | { readonly allowed: false; readonly status: number; readonly error: string };
}

export interface DeviceProfileOperationsPort {
  operatingState(printerId: string): Promise<DeviceOperatingState>;
  liveState(printerId: string): Promise<DeviceLiveState>;
  queueCommand(
    printerId: string,
    userId: UserId,
    idempotencyKey: string,
    input: { readonly command: string; readonly slice_id?: string; readonly file_name?: string },
    requestId: string,
  ): Promise<DeviceQueuedProfileCommand>;
  commandStatus(printerId: string, commandId: string): Promise<DeviceProfileCommandStatus | null>;
}

export interface DevicePublicApiOperationsPort {
  publicListPrinters(ownerId: UserId): Promise<{ readonly printers: readonly PublicPrinterResponse[] }>;
  publicPrinter(ownerId: UserId, deviceId: string): Promise<PublicPrinterResponse>;
  publicTelemetry(ownerId: UserId, deviceId: string, query: { readonly limit?: string; readonly since?: string }): Promise<{ readonly telemetry: readonly PublicTelemetryItem[] }>;
  publicTestJobCommand(
    ownerId: UserId,
    deviceId: string,
    body: Readonly<Record<string, unknown>>,
    idempotencyKey: unknown,
    requestId: string,
  ): Promise<{ readonly status: number; readonly body: PublicTestQueryResponse } | { readonly status: number; readonly body: PublicQueuedCommandResponse }>;
  publicCommand(
    ownerId: UserId,
    deviceId: string,
    body: Readonly<Record<string, unknown>>,
    idempotencyKey: unknown,
    requestId: string,
    hasControlScope: boolean,
  ): Promise<{ readonly status: number; readonly body: PublicQueuedCommandResponse }>;
  publicCommandStatus(ownerId: UserId, deviceId: string, commandId: string): Promise<PublicCommandStatusResponse>;
}

export interface DevicesPort {
  createEnrollCode(actorId: UserId, body: Record<string, unknown>): Promise<{ readonly status: number; readonly body: DeviceEnrollCodeResponse }>;
  revokeEnrollCode(actorId: UserId, enrollCodeId: string): Promise<void>;
  revokeDevice(actorId: UserId, deviceId: string, reason: unknown, requestId: string): Promise<{ readonly ok: true }>;
  installScript(): { readonly contentType: string; readonly body: string };
  enrollAgent(body: Record<string, unknown>, requestId: string, credentialKind?: "enrollment" | "recovery"): Promise<{ readonly status: number; readonly body: DeviceEnrollmentResponse }>;
  upsertShare(actorId: UserId, deviceId: string, body: Record<string, unknown>): Promise<{ readonly status: number; readonly body: { readonly share: DeviceShareResponse } }>;
  deleteShare(actorId: UserId, deviceId: string, userId: string): Promise<{ readonly ok: true }>;
  createCommand(actorId: UserId, deviceId: string, body: Record<string, unknown>, idempotencyKey: unknown, requestId: string): Promise<DeviceCommandResponse>;
  getCommand(actorId: UserId, deviceId: string, commandId: string): Promise<DeviceCommandResponse>;
  createTransfer(
    actorId: UserId,
    deviceId: string,
    body: Record<string, unknown>,
    requestId: string,
  ): Promise<{
    readonly status: number;
    readonly body: DeviceTransferResponse & {
      readonly data_plane: {
        readonly protocol: string;
        readonly transfer_id: string;
        readonly file_name: string;
        readonly size_bytes: number;
        readonly sha256: string | null;
        readonly start_print: boolean;
        readonly next_seq: number;
      };
    };
  }>;
  getTransfer(actorId: UserId, deviceId: string, transferId: string): Promise<DeviceTransferResponse>;
  listIncidents(actorId: UserId, deviceId: string): Promise<{ readonly items: readonly DeviceIncidentResponse[] }>;
  acknowledgeIncident(actorId: UserId, deviceId: string, incidentId: string): Promise<{ readonly incident: DeviceIncidentResponse }>;
  resolveIncident(actorId: UserId, deviceId: string, incidentId: string): Promise<{ readonly incident: DeviceIncidentResponse }>;
  transferProfile(
    actorId: UserId,
    deviceId: string,
    body: Record<string, unknown>,
    context: DeviceRequestContext,
  ): Promise<{ readonly status: number; readonly body: DeviceProfileTransferResponse }>;
  createPrintRequest(
    actorId: UserId,
    deviceId: string,
    body: Record<string, unknown>,
    idempotencyKey: unknown,
    context: DeviceRequestContext,
  ): Promise<{ readonly status: number; readonly body: DevicePrintRequestResponse }>;
  getPrintRequest(actorId: UserId, deviceId: string, id: string): Promise<DevicePrintRequestResponse>;
  confirmPrintStart(actorId: UserId, deviceId: string, id: string, requestId: string): Promise<{ readonly status: number; readonly body: DevicePrintRequestResponse }>;
}
export { buildInstallScript } from "../infrastructure/install-script.ts";
export { issueAgentCredential } from "../infrastructure/agent-session.ts";
export { issueCommandToken } from "../infrastructure/command-token.ts";
export { issueGatewayCertificate } from "../infrastructure/gateway-certificate.ts";
export { stageDeviceTransfer } from "../infrastructure/transfer-object-store.ts";
export { normalizeCommandResult } from "../infrastructure/command-result.ts";
export { DEVICE_COMMAND_ALLOWLIST, evaluateCommand, evaluateSafeTestJobCommand, isKnownCommand } from "../infrastructure/command-policy.ts";
