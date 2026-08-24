export const DEVICE_AGENT_RUNTIME_CONTRACT_VERSION = "device-agent-runtime.v1" as const;
export const COMMAND_TOKEN_ALGORITHMS = ["EdDSA"] as const;
export const MAX_COMMAND_VERIFICATION_KEYS = 2 as const;
export const TRANSFER_SPOOL_SCHEMA_VERSION = 1 as const;

declare const runtimeIdentifierBrand: unique symbol;
export type RuntimeIdentifier<Kind extends string> = string & { readonly [runtimeIdentifierBrand]: Kind };
export type GatewayId = RuntimeIdentifier<"GatewayId">;
export type DeviceId = RuntimeIdentifier<"DeviceId">;
export type CommandId = RuntimeIdentifier<"CommandId">;
export type TransferId = RuntimeIdentifier<"TransferId">;

export const GatewayId = (value: unknown): GatewayId | null => identifier<GatewayId>(value);
export const DeviceId = (value: unknown): DeviceId | null => identifier<DeviceId>(value);
export const CommandId = (value: unknown): CommandId | null => identifier<CommandId>(value);
export const TransferId = (value: unknown): TransferId | null => identifier<TransferId>(value);

export type CommandVerificationKey = {
  readonly kid: string;
  readonly alg: "EdDSA";
  readonly kty: "OKP";
  readonly crv: "Ed25519";
  readonly x: string;
};

export type CommandVerificationKeySet = {
  readonly version: typeof DEVICE_AGENT_RUNTIME_CONTRACT_VERSION;
  readonly issuer: string;
  readonly audience: string;
  readonly keys: readonly CommandVerificationKey[];
};

export type DeviceEnrollmentResponseV1 = {
  readonly version: typeof DEVICE_AGENT_RUNTIME_CONTRACT_VERSION;
  readonly agent_id: string;
  readonly gateway_id: GatewayId;
  readonly device_id: DeviceId;
  readonly owner_id: string;
  readonly certificate_pem: string;
  readonly certificate_chain_pem: readonly string[];
  readonly ca_bundle_pem: readonly string[];
  readonly certificate_fingerprint_sha256: string;
  readonly command_verification: CommandVerificationKeySet;
  readonly expires_at: string;
};

export type DeviceAgentHealthV1 = {
  readonly version: "health.v1";
  readonly status: "healthy" | "degraded" | "blocked_config" | "revoked";
  readonly revision: number;
  readonly agent_version: string;
  readonly agent_commit_sha: string;
  readonly reason_code: string | null;
  readonly moonraker: { readonly state: "not_configured" | "connecting" | "ready" | "unavailable" | "stopped" };
  readonly relay: {
    readonly state: "not_configured" | "connecting" | "socket_open" | "authorizing" | "authorized" | "backoff" | "rejected" | "revoked" | "stopped";
    readonly connection_generation: number | null;
  };
};

export type TransferSpoolStateV1 = {
  readonly schemaVersion: typeof TRANSFER_SPOOL_SCHEMA_VERSION;
  readonly metadata: {
    readonly transferId: TransferId;
    readonly gatewayId: GatewayId;
    readonly deviceId: DeviceId;
    readonly fileName: string;
    readonly sizeBytes: number;
    readonly sha256: string;
    readonly objectVersion: string;
    readonly chunkSizeBytes: number;
    readonly startPrint: boolean;
    readonly kind: "gcode" | "printer_profile";
  };
  readonly metadataHashSha256: string;
  readonly stateChecksumSha256: string;
  readonly committedOffset: number;
  readonly nextSequence: number;
  readonly phase: "receiving" | "upload_intent" | "upload_complete" | "start_intent" | "terminal" | "quarantined" | "reconciliation_required";
  readonly frames: readonly {
    readonly seq: number;
    readonly offsetBytes: number;
    readonly lengthBytes: number;
    readonly digestSha256: string;
    readonly last: boolean;
  }[];
  readonly uploadIntent: { readonly attemptedAt: string } | null;
  readonly uploadResult: { readonly ok: true; readonly storedAs: string } | { readonly ok: false; readonly error: string } | null;
  readonly startIntent: { readonly attemptedAt: string } | null;
  readonly startResult: { readonly ok: true } | { readonly ok: false; readonly error: string } | null;
  readonly terminalResult: FileResult | null;
  readonly quarantineReason: string | null;
  readonly updatedAt: string;
};

type JsonObject = Record<string, unknown>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256 = /^[0-9a-f]{64}$/;
const BASE64URL = /^[A-Za-z0-9_-]+$/;
const IDENTIFIER = /^[A-Za-z0-9._:-]{1,128}$/;

function identifier<T extends RuntimeIdentifier<string>>(value: unknown): T | null {
  return typeof value === "string" && IDENTIFIER.test(value) ? value as T : null;
}

function object(value: unknown): JsonObject | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : null;
}
function exact(value: JsonObject, keys: readonly string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key)) && keys.every((key) => key in value);
}
function iso(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}
function nonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

export function isCommandVerificationKeySet(value: unknown): value is CommandVerificationKeySet {
  const set = object(value);
  if (set === null || !exact(set, ["version", "issuer", "audience", "keys"])) return false;
  if (set.version !== DEVICE_AGENT_RUNTIME_CONTRACT_VERSION || typeof set.issuer !== "string" || !set.issuer || typeof set.audience !== "string" || !set.audience) return false;
  if (!Array.isArray(set.keys) || set.keys.length < 1 || set.keys.length > MAX_COMMAND_VERIFICATION_KEYS) return false;
  const kids = new Set<string>();
  for (const raw of set.keys) {
    const key = object(raw);
    if (key === null || !exact(key, ["kid", "alg", "kty", "crv", "x"])) return false;
    if (typeof key.kid !== "string" || !key.kid || kids.has(key.kid) || key.alg !== "EdDSA" || key.kty !== "OKP" || key.crv !== "Ed25519" || typeof key.x !== "string" || !BASE64URL.test(key.x)) return false;
    kids.add(key.kid);
  }
  return true;
}

export function isDeviceEnrollmentResponseV1(value: unknown): value is DeviceEnrollmentResponseV1 {
  const response = object(value);
  if (response === null || !exact(response, ["version", "agent_id", "gateway_id", "device_id", "owner_id", "certificate_pem", "certificate_chain_pem", "ca_bundle_pem", "certificate_fingerprint_sha256", "command_verification", "expires_at"])) return false;
  return response.version === DEVICE_AGENT_RUNTIME_CONTRACT_VERSION
    && typeof response.agent_id === "string" && UUID.test(response.agent_id)
    && typeof response.gateway_id === "string" && UUID.test(response.gateway_id)
    && typeof response.device_id === "string" && UUID.test(response.device_id)
    && typeof response.owner_id === "string" && UUID.test(response.owner_id)
    && typeof response.certificate_pem === "string" && response.certificate_pem.includes("BEGIN CERTIFICATE")
    && Array.isArray(response.certificate_chain_pem) && response.certificate_chain_pem.every((item) => typeof item === "string" && item.includes("BEGIN CERTIFICATE"))
    && Array.isArray(response.ca_bundle_pem) && response.ca_bundle_pem.every((item) => typeof item === "string" && item.includes("BEGIN CERTIFICATE"))
    && typeof response.certificate_fingerprint_sha256 === "string" && SHA256.test(response.certificate_fingerprint_sha256)
    && isCommandVerificationKeySet(response.command_verification)
    && iso(response.expires_at);
}

export function isDeviceAgentHealthV1(value: unknown): value is DeviceAgentHealthV1 {
  const health = object(value);
  if (health === null || !exact(health, ["version", "status", "revision", "agent_version", "agent_commit_sha", "reason_code", "moonraker", "relay"])) return false;
  const moonraker = object(health.moonraker);
  const relay = object(health.relay);
  return health.version === "health.v1"
    && ["healthy", "degraded", "blocked_config", "revoked"].includes(String(health.status))
    && nonNegativeInteger(health.revision) && typeof health.agent_version === "string" && health.agent_version.length > 0
    && typeof health.agent_commit_sha === "string" && /^[a-f0-9]{7,64}$/i.test(health.agent_commit_sha)
    && (health.reason_code === null || typeof health.reason_code === "string")
    && moonraker !== null && exact(moonraker, ["state"]) && ["not_configured", "connecting", "ready", "unavailable", "stopped"].includes(String(moonraker.state))
    && relay !== null && exact(relay, ["state", "connection_generation"]) && ["not_configured", "connecting", "socket_open", "authorizing", "authorized", "backoff", "rejected", "revoked", "stopped"].includes(String(relay.state))
    && (relay.connection_generation === null || nonNegativeInteger(relay.connection_generation));
}

export function isTransferSpoolStateV1(value: unknown): value is TransferSpoolStateV1 {
  const state = object(value);
  if (state === null || !exact(state, ["schemaVersion", "metadata", "metadataHashSha256", "stateChecksumSha256", "committedOffset", "nextSequence", "phase", "frames", "uploadIntent", "uploadResult", "startIntent", "startResult", "terminalResult", "quarantineReason", "updatedAt"])) return false;
  const metadata = object(state.metadata);
  if (metadata === null || !exact(metadata, ["transferId", "gatewayId", "deviceId", "fileName", "sizeBytes", "sha256", "objectVersion", "chunkSizeBytes", "startPrint", "kind"])) return false;
  return state.schemaVersion === TRANSFER_SPOOL_SCHEMA_VERSION
    && typeof metadata.transferId === "string" && IDENTIFIER.test(metadata.transferId)
    && typeof metadata.gatewayId === "string" && IDENTIFIER.test(metadata.gatewayId)
    && typeof metadata.deviceId === "string" && IDENTIFIER.test(metadata.deviceId)
    && typeof metadata.fileName === "string" && metadata.fileName.length > 0 && metadata.fileName.length <= 255
    && nonNegativeInteger(metadata.sizeBytes) && metadata.sizeBytes > 0
    && typeof metadata.sha256 === "string" && SHA256.test(metadata.sha256)
    && typeof metadata.objectVersion === "string" && IDENTIFIER.test(metadata.objectVersion)
    && nonNegativeInteger(metadata.chunkSizeBytes) && metadata.chunkSizeBytes > 0 && metadata.chunkSizeBytes <= 65_536
    && typeof metadata.startPrint === "boolean" && ["gcode", "printer_profile"].includes(String(metadata.kind))
    && typeof state.metadataHashSha256 === "string" && SHA256.test(state.metadataHashSha256)
    && typeof state.stateChecksumSha256 === "string" && SHA256.test(state.stateChecksumSha256)
    && nonNegativeInteger(state.committedOffset) && nonNegativeInteger(state.nextSequence) && state.committedOffset <= metadata.sizeBytes
    && ["receiving", "upload_intent", "upload_complete", "start_intent", "terminal", "quarantined", "reconciliation_required"].includes(String(state.phase))
    && Array.isArray(state.frames) && state.frames.every(isCommittedFrame)
    && isIntent(state.uploadIntent) && isUploadResult(state.uploadResult) && isIntent(state.startIntent) && isStartResult(state.startResult)
    && isTerminalResult(state.terminalResult)
    && (state.quarantineReason === null || typeof state.quarantineReason === "string")
    && iso(state.updatedAt);
}

function isCommittedFrame(value: unknown): boolean {
  const frame = object(value);
  return frame !== null && exact(frame, ["seq", "offsetBytes", "lengthBytes", "digestSha256", "last"])
    && nonNegativeInteger(frame.seq) && nonNegativeInteger(frame.offsetBytes) && nonNegativeInteger(frame.lengthBytes)
    && typeof frame.digestSha256 === "string" && SHA256.test(frame.digestSha256) && typeof frame.last === "boolean";
}

function isIntent(value: unknown): boolean {
  if (value === null) return true;
  const intent = object(value);
  return intent !== null && exact(intent, ["attemptedAt"]) && iso(intent.attemptedAt);
}

function isUploadResult(value: unknown): boolean {
  if (value === null) return true;
  const result = object(value);
  if (result === null || typeof result.ok !== "boolean") return false;
  return result.ok
    ? exact(result, ["ok", "storedAs"]) && typeof result.storedAs === "string" && result.storedAs.length > 0
    : exact(result, ["ok", "error"]) && typeof result.error === "string" && result.error.length > 0;
}

function isStartResult(value: unknown): boolean {
  if (value === null) return true;
  const result = object(value);
  if (result === null || typeof result.ok !== "boolean") return false;
  return result.ok ? exact(result, ["ok"]) : exact(result, ["ok", "error"]) && typeof result.error === "string" && result.error.length > 0;
}

function isTerminalResult(value: unknown): boolean {
  if (value === null) return true;
  const result = object(value);
  if (result === null || result.type !== "file_result" || typeof result.device_id !== "string" || !IDENTIFIER.test(result.device_id) || typeof result.transfer_id !== "string" || !IDENTIFIER.test(result.transfer_id)) return false;
  if (result.outcome === "stored") return exact(result, ["type", "device_id", "transfer_id", "outcome", "stored_as"]) && typeof result.stored_as === "string" && result.stored_as.length > 0;
  if (result.outcome !== "failed" || typeof result.error_code !== "string") return false;
  const allowed = ["type", "device_id", "transfer_id", "outcome", "error_code", "next_seq", "next_offset_bytes", "message"];
  return Object.keys(result).every((key) => allowed.includes(key))
    && ["type", "device_id", "transfer_id", "outcome", "error_code"].every((key) => key in result)
    && (result.next_seq === undefined || nonNegativeInteger(result.next_seq))
    && (result.next_offset_bytes === undefined || nonNegativeInteger(result.next_offset_bytes))
    && (result.message === undefined || typeof result.message === "string");
}

export function parsePersistedJson(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}
import type { FileResult } from "../../device-protocol/v1/index.ts";
