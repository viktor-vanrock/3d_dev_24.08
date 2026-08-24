import type { QueryResult, QueryResultRow } from "pg";
import type { UserId } from "../../_kernel/brandedIds.ts";

export const PRINTERS_PORT = Symbol("PRINTERS_PORT");
export const PRINTER_OWNER_PORT = Symbol("PRINTER_OWNER_PORT");
export { loadCompatFleet, type FleetPrinter } from "../infrastructure/compatibility-fleet.ts";
export { findOwnedPrinterSliceContext, setOwnedPrinterFingerprintIfEmpty, type OwnedPrinterSliceContext } from "../infrastructure/user-printer-owner.ts";
export const PRINTER_PROFILE_READ_PORT = Symbol("PRINTER_PROFILE_READ_PORT");
export const PRINTER_RESEARCH_AUTH_PORT = Symbol("PRINTER_RESEARCH_AUTH_PORT");
export const PRINTER_PRUSA_PORT = Symbol("PRINTER_PRUSA_PORT");
export const PRINTER_CATALOG_MATCH_PORT = Symbol("PRINTER_CATALOG_MATCH_PORT");
export const PRINTER_STORAGE_PORT = Symbol("PRINTER_STORAGE_PORT");
export const PRINTER_ANALYTICS_PORT = Symbol("PRINTER_ANALYTICS_PORT");
export const PRINTER_ACTIVATION_PORT = Symbol("PRINTER_ACTIVATION_PORT");
export const PRINTER_CATALOG_READ_PORT = Symbol("PRINTER_CATALOG_READ_PORT");
export const PRINTER_RELAY_PORT = Symbol("PRINTER_RELAY_PORT");

export type PrinterJsonScalar = string | number | boolean | null;
export type PrinterJsonValue = PrinterJsonScalar | readonly PrinterJsonValue[] | PrinterJsonObject;
export interface PrinterJsonObject {
  readonly [key: string]: PrinterJsonValue;
}
export interface PrinterCatalogBuildVolume {
  readonly x: number | null;
  readonly y: number | null;
  readonly z: number | null;
  readonly shape: string | null;
  readonly diameter: number | null;
}
export interface PrinterCatalogHotend {
  readonly max_temp_c: number | null;
  readonly max_flow_mm3s: number | null;
  readonly nozzle_default_mm: number | null;
  readonly nozzle_swappable: boolean | null;
  readonly material: string | null;
  readonly hardened: boolean | null;
}
export interface PrinterCatalogBed {
  readonly max_temp_c: number | null;
  readonly surface: string | null;
  readonly auto_leveling: string | null;
}
export interface PrinterCatalogSpeed {
  readonly max_speed_mms: number | null;
  readonly max_accel_mms2: number | null;
  readonly input_shaping: boolean | null;
}
export interface PrinterCatalogMultimaterial {
  readonly supported: boolean;
  readonly system_name: string | null;
  readonly max_colors: number | null;
  readonly unique_notes: string | null;
}
export interface PrinterCatalogToolheadExtra {
  readonly kind: string;
  readonly spec: string | null;
}
export interface PrinterCatalogConnectivity {
  readonly wifi: boolean | null;
  readonly ethernet: boolean | null;
  readonly usb: boolean | null;
  readonly camera: boolean | null;
  readonly firmware: string | null;
  readonly moonraker: boolean | null;
  readonly lan_mode: boolean | null;
}
export interface PrinterCatalogDimensions {
  readonly w: number | null;
  readonly d: number | null;
  readonly h: number | null;
  readonly weight_kg: number | null;
}
export interface PrinterCatalogPrice {
  readonly msrp_usd: number | null;
  readonly ru_rub: number | null;
  readonly ru_updated_at: string | null;
}
export interface PrinterCatalogMedia {
  readonly hero: string | null;
  readonly gallery: readonly string[];
  readonly official_url: string | null;
}
export type PrinterPilotStatus =
  | { readonly status: "no_data" }
  | {
      readonly status: "reported";
      readonly updated_at: string;
      readonly freshness: "fresh" | "stale";
      readonly source: string;
      readonly stage: string;
      readonly confidence: string;
    };
export interface PrinterCatalogMeta {
  readonly schema_version: string;
  readonly filled_by: string | null;
  readonly reviewed_by: string | null;
  readonly confidence: string | null;
  readonly gaps: readonly string[];
  readonly verified: boolean;
  readonly updated_at: string | null;
}
export interface PrinterCatalogPrinter {
  readonly id: string;
  readonly slug: string;
  readonly brand: string;
  readonly model: string;
  readonly aliases: readonly string[];
  readonly released_at: string | null;
  readonly status: string;
  readonly kinematics: string | null;
  readonly type: string | null;
  readonly enclosed: boolean | null;
  readonly build_volume: PrinterCatalogBuildVolume;
  readonly hotend: PrinterCatalogHotend;
  readonly bed: PrinterCatalogBed;
  readonly speed: PrinterCatalogSpeed;
  readonly multimaterial: PrinterCatalogMultimaterial;
  readonly toolhead_extras: readonly PrinterCatalogToolheadExtra[];
  readonly connectivity: PrinterCatalogConnectivity;
  readonly materials_supported: readonly string[];
  readonly dimensions_mm: PrinterCatalogDimensions;
  readonly price: PrinterCatalogPrice;
  readonly unique_features: readonly string[];
  readonly support_level: string | null;
  readonly firmware_ready: boolean | null;
  readonly firmware_public: boolean | null;
  readonly connector_type: string | null;
  readonly firmware_repo: string | null;
  readonly pilot_status: PrinterPilotStatus;
  readonly media: PrinterCatalogMedia;
  readonly sources: readonly string[];
  readonly field_sources: PrinterJsonObject;
  readonly _meta: PrinterCatalogMeta;
}
export interface PrinterCatalogListItem {
  readonly id: string;
  readonly slug: string;
  readonly brand: string;
  readonly model: string;
  readonly status: string;
  readonly verified: boolean;
  readonly image_url: string | null;
  readonly price: { readonly rub: number | null; readonly usd: number | null; readonly rub_updated_at: string | null };
  readonly build_volume_mm: { readonly x: number | null; readonly y: number | null; readonly z: number | null };
  readonly kinematics: string | null;
  readonly capabilities: readonly string[];
}
export interface PrinterCatalogListResponse {
  readonly contract_version: "printers.catalog.v1";
  readonly items: readonly PrinterCatalogListItem[];
  readonly printers: readonly PrinterCatalogPrinter[];
  readonly has_more: boolean;
  readonly next_cursor: string | null;
  readonly gap_counts: { readonly [key: string]: number };
}
export interface PrinterCatalogDetailResponse {
  readonly printer: PrinterCatalogPrinter;
}

export interface PrinterCatalogReadPort {
  list(input: Readonly<Record<string, unknown>>): Promise<{ readonly ok: true; readonly body: PrinterCatalogListResponse } | { readonly ok: false }>;
  detail(slug: string): Promise<PrinterCatalogDetailResponse | null>;
}

export interface PrinterQueryExecutor {
  query<R extends QueryResultRow = QueryResultRow>(text: string, values?: readonly unknown[]): Promise<QueryResult<R>>;
}

export interface ProfilePrinterSummary {
  readonly id: string;
  readonly printer_id: string | null;
  readonly catalog_printer_id: string | null;
  readonly brand: string;
  readonly model: string;
  readonly build_volume: PrinterBuildVolume | null;
  readonly nozzle_mm: string | null;
  readonly kinematics: string | null;
  readonly link_source: string;
  readonly lan_endpoint: string | null;
  readonly verified: boolean;
  readonly is_primary: boolean;
  readonly created_at: Date;
}

export interface OwnedUserPrinter extends ProfilePrinterSummary {
  readonly user_id: UserId;
  readonly connection_mode: string;
  readonly connection_id?: string | null;
  readonly external_ref?: string | null;
  readonly status?: string | null;
  readonly agent_id?: string | null;
  readonly firmware_class?: string | null;
  readonly last_seen_at?: Date | null;
  readonly capabilities?: unknown;
  readonly config_fingerprint?: string | null;
}

export interface CreateOwnedPrinterInput {
  readonly printerId: string | null;
  readonly catalogPrinterId: string | null;
  readonly brand: string;
  readonly model: string;
  readonly buildVolume: PrinterBuildVolume | null;
  readonly nozzleMm: number | null;
  readonly kinematics: string | null;
  readonly linkSource: string;
  readonly verified: boolean;
  readonly isPrimary?: boolean;
  readonly lanEndpoint: string | null;
  readonly connectionMode: "list" | "managed-local" | "managed-bridge";
  readonly connectionId?: string | null;
  readonly externalRef?: string | null;
  readonly status?: string | null;
  readonly agentId?: string | null;
  readonly firmwareClass?: string | null;
}

export interface PrinterBuildVolume {
  readonly x?: number;
  readonly y?: number;
  readonly z?: number;
}

export interface EnrollOwnedPrinterInput {
  readonly userId: UserId;
  readonly printerId?: string;
  readonly brand: string;
  readonly model: string;
  readonly agentId: string;
  readonly firmwareClass: string | null;
  readonly verified?: boolean;
}

export interface PrinterDeviceContext {
  readonly connectionMode: unknown;
  readonly linkSource: unknown;
  readonly agentId: string | null;
  readonly deviceLastSeenAt: Date | string | null;
  readonly capabilities: unknown;
  readonly configFingerprint: string | null;
  readonly printerId: string | null;
  readonly buildVolume: { readonly x: number; readonly y: number; readonly z: number } | null;
}

export interface PrinterEnrollmentTarget {
  readonly id: string;
  readonly brand: string;
  readonly model: string;
  readonly firmwareClass: string | null;
  readonly agentId: string | null;
}

export interface PrinterProfileReadPort {
  countByUser(userId: UserId): Promise<number>;
  listByUser(userId: UserId): Promise<readonly ProfilePrinterSummary[]>;
}

export interface PrinterOwnerPort extends PrinterProfileReadPort {
  listOwned(userId: UserId, executor?: PrinterQueryExecutor): Promise<readonly OwnedUserPrinter[]>;
  catalogPrinterExists(printerId: string, executor?: PrinterQueryExecutor): Promise<boolean>;
  findById(printerId: string, executor?: PrinterQueryExecutor): Promise<OwnedUserPrinter | null>;
  findOwner(printerId: string, executor?: PrinterQueryExecutor): Promise<UserId | null>;
  create(userId: UserId, input: CreateOwnedPrinterInput, executor?: PrinterQueryExecutor): Promise<OwnedUserPrinter>;
  update(printerId: string, userId: UserId, values: Readonly<Record<string, unknown>>, executor?: PrinterQueryExecutor): Promise<OwnedUserPrinter | null>;
  delete(printerId: string, userId: UserId, executor?: PrinterQueryExecutor): Promise<boolean>;
  compareAndSetAgent(printerId: string, expectedAgentId: string | null, nextAgentId: string | null, executor?: PrinterQueryExecutor): Promise<OwnedUserPrinter | null>;
  enroll(executor: PrinterQueryExecutor, input: EnrollOwnedPrinterInput): Promise<OwnedUserPrinter>;
  touchByAgent(printerId: string, agentId: string, executor?: PrinterQueryExecutor): Promise<UserId | null>;
  getDeviceOwner(deviceId: string, executor?: PrinterQueryExecutor): Promise<UserId | null>;
  getDeviceCommandContext(deviceId: string, executor?: PrinterQueryExecutor): Promise<PrinterDeviceContext | null>;
  getDevicePrintContext(deviceId: string, executor?: PrinterQueryExecutor): Promise<PrinterDeviceContext | null>;
  getEnrollmentTarget(ownerId: UserId, deviceId: string, executor?: PrinterQueryExecutor): Promise<PrinterEnrollmentTarget | null>;
  createManagedDevice(executor: PrinterQueryExecutor, input: EnrollOwnedPrinterInput): Promise<OwnedUserPrinter>;
  linkAgent(executor: PrinterQueryExecutor, deviceId: string, agentId: string): Promise<OwnedUserPrinter | null>;
  getAgentIdForOwnedDevice(deviceId: string, ownerId: UserId, executor?: PrinterQueryExecutor): Promise<string | null>;
  setConfigFingerprintIfEmpty(printerId: string, agentId: string, fingerprint: string, executor?: PrinterQueryExecutor): Promise<boolean>;
}

export interface PrinterRelayPort {
  authorizedDeviceIds(agentId: string, requestedDeviceIds: readonly string[] | undefined, executor: PrinterQueryExecutor): Promise<readonly string[]>;
  isDeviceAuthorized(deviceId: string, agentId: string, executor: PrinterQueryExecutor): Promise<boolean>;
  recordDeviceHeartbeat(deviceId: string, agentId: string, status: string, executor: PrinterQueryExecutor): Promise<boolean>;
}

export interface PrusaPrinterProjection {
  readonly externalRef: string;
  readonly name: string | null;
  readonly modelName: string;
  readonly state: string;
}

export type PrusaListResult = { readonly ok: true; readonly printers: readonly PrusaPrinterProjection[] } | { readonly ok: false; readonly reason: "auth" | "unavailable" };

export interface PrinterPrusaPort {
  listPrinters(apiKey: string): Promise<PrusaListResult>;
  encryptKey(apiKey: string): Buffer;
  decryptKey(value: Buffer): string | null;
}

export interface PrinterCatalogMatchPort {
  matchPrusaModel(modelName: string): Promise<string | null>;
}

export interface PrinterResearchAuthPort {
  resolveUser(identity: { readonly authorization: string | undefined; readonly cookie: string | undefined }): Promise<UserId | null>;
  isResearcher(userId: UserId): Promise<boolean>;
}

export interface PrinterStoragePort {
  uploadUrl(key: string, contentType: string): Promise<string | null>;
  objectUrl(key: string): Promise<string | null>;
}

export interface PrinterAnalyticsPort {
  printerUpserted(input: {
    readonly anonId: string;
    readonly userId: UserId;
    readonly printerId: string;
    readonly slug: string;
    readonly brand: string;
    readonly model: string;
    readonly confidence: string | null;
    readonly gapsCount: number;
    readonly sourcesCount: number;
    readonly filledBy: string | null;
    readonly isNew: boolean;
  }): Promise<void>;
}

export interface PrinterActivationPort {
  lockUser(userId: UserId, executor: PrinterQueryExecutor): Promise<boolean>;
  setHasPrinter(userId: UserId, value: boolean, executor?: PrinterQueryExecutor): Promise<void>;
}

export interface CommunityFirmwareResponse {
  readonly id: string;
  readonly printer_id: string | null;
  readonly model: string;
  readonly author: string;
  readonly git_url: string;
  readonly verified: boolean;
  readonly created_at: Date;
  readonly updated_at: Date;
}
export interface CommunityFirmwarePageResponse {
  readonly entries: readonly CommunityFirmwareResponse[];
  readonly limit: number;
  readonly offset: number;
  readonly has_more: boolean;
}
export interface PrinterEnrollmentCodeResponse {
  readonly label: string;
  readonly hint: string;
  readonly keyboard: "default" | "number";
}
export interface PrinterEnrollmentStepResponse {
  readonly brand: string;
  readonly reason: "confirm-on-printer" | "token-required" | "not-required";
  readonly title: string;
  readonly instructions: string;
  readonly code: PrinterEnrollmentCodeResponse | null;
  readonly present_as: string;
}
export interface PrinterConnectProtocolResponse {
  readonly id: string;
  readonly ports: readonly number[];
  readonly identity_path: string;
  readonly system_info_path: string;
  readonly objects_path: string;
  readonly toolhead_path: string;
  readonly upload_path: string;
  readonly start_path: string;
  readonly probe_timeout_ms: number;
  readonly probe_concurrency: number;
}
export interface PrinterConnectRecipeResponse {
  readonly version: number;
  readonly protocols: readonly PrinterConnectProtocolResponse[];
  readonly min_prefix_length: number;
  readonly access_path: string;
  readonly enrollment: readonly PrinterEnrollmentStepResponse[];
}
export interface PrinterIdentityMatchResponse {
  readonly printer_id: string;
  readonly slug: string;
  readonly brand: string;
  readonly model: string;
  readonly kinematics: string | null;
  readonly catalog_build_volume_mm: { readonly x: number; readonly y: number; readonly z: number } | null;
  readonly confidence: "high" | "medium";
  readonly matched_by: readonly string[];
}
export interface PrinterIdentityResponse {
  readonly match: PrinterIdentityMatchResponse | null;
  readonly signals: { readonly vendor: string | null; readonly extruders: number | null; readonly macro_prefixes: readonly string[] };
}
export interface PrinterPrusaSyncResponse {
  readonly connected: true;
  readonly printers_found: number;
  readonly printers_matched: number;
}
export type PrinterPrusaStatusResponse =
  { readonly connected: false } | { readonly connected: true; readonly status: string; readonly last_synced_at: string | null; readonly last_error: string | null };
export interface PrinterDisconnectResponse {
  readonly ok: boolean;
}
export interface PrinterResearchConflictResponse {
  readonly field: string;
  readonly ours: PrinterJsonValue;
  readonly theirs: PrinterJsonValue;
}
export interface PrinterResearchUpsertResponse {
  readonly printer: PrinterCatalogPrinter;
  readonly conflicts: readonly PrinterResearchConflictResponse[];
  readonly draft: boolean;
}
export interface PrinterResearchUploadResponse {
  readonly upload_url: string;
  readonly key: string;
}
export interface PrinterReportResponse {
  readonly id: string;
  readonly printer_id: string;
  readonly field: string;
  readonly note: string | null;
  readonly proposed_value: PrinterJsonValue;
  readonly votes: number;
  readonly status: "pending" | "approved" | "rejected";
  readonly source: string;
  readonly confidence: string;
  readonly resolved_by: string | null;
  readonly resolved_at: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}
export interface PrinterReportEnvelopeResponse {
  readonly report: PrinterReportResponse;
}
export interface PrinterReportListItemResponse extends PrinterReportResponse {
  readonly printer: { readonly slug: string; readonly brand: string; readonly model: string };
}
export interface PrinterReportsResponse {
  readonly reports: readonly PrinterReportListItemResponse[];
}
export type PrinterReportApprovalResponse =
  { readonly report: PrinterReportResponse; readonly applied: false } | { readonly report: PrinterReportResponse; readonly applied: true; readonly printer: PrinterCatalogPrinter };

export interface PrintersPort {
  communityFirmwareList(query: Readonly<Record<string, string | undefined>>): Promise<CommunityFirmwarePageResponse>;
  communityFirmwareCreate(userId: UserId, body: Readonly<Record<string, unknown>>): Promise<CommunityFirmwareResponse>;
  communityFirmwareUpdate(userId: UserId, id: string, body: Readonly<Record<string, unknown>>): Promise<CommunityFirmwareResponse>;
  communityFirmwareDelete(userId: UserId, id: string): Promise<void>;
  connectRecipe(): PrinterConnectRecipeResponse;
  identify(body: unknown): Promise<PrinterIdentityResponse>;
  connectPrusa(userId: UserId, apiKey: unknown): Promise<PrinterPrusaSyncResponse>;
  syncPrusa(userId: UserId): Promise<PrinterPrusaSyncResponse>;
  prusaStatus(userId: UserId): Promise<PrinterPrusaStatusResponse>;
  disconnectPrusa(userId: UserId): Promise<PrinterDisconnectResponse>;
  researchUpsert(userId: UserId, anonId: string, body: Readonly<Record<string, unknown>>): Promise<{ readonly status: 200 | 201; readonly body: PrinterResearchUpsertResponse }>;
  researchDetail(userId: UserId, slug: string): Promise<PrinterCatalogDetailResponse>;
  researchUpload(userId: UserId, slug: unknown, contentType: unknown): Promise<PrinterResearchUploadResponse>;
  researchMedia(userId: UserId, key: string): Promise<string>;
  report(userId: UserId, idOrSlug: string, body: Readonly<Record<string, unknown>>): Promise<PrinterReportEnvelopeResponse>;
  reports(userId: UserId, status: string | undefined): Promise<PrinterReportsResponse>;
  rejectReport(userId: UserId, reportId: string): Promise<PrinterReportEnvelopeResponse>;
  approveReport(userId: UserId, reportId: string): Promise<PrinterReportApprovalResponse>;
}
export { evaluatePrinterCommand, printerCommandPolicyStatus } from "../infrastructure/command-policy.ts";
export { prusaConnectClient, PrusaAuthError } from "../infrastructure/prusa-connect.client.ts";
