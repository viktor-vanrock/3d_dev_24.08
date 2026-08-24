export const CATALOG_READ_PORT = Symbol("CATALOG_READ_PORT");
export const CATALOG_MAKES_PORT = Symbol("CATALOG_MAKES_PORT");
export const CATALOG_PORT = Symbol("CATALOG_PORT");
export const CATALOG_EXTERNAL_PORT = Symbol("CATALOG_EXTERNAL_PORT");
export { CatalogCursorError, decodePrinterCatalogCursor, encodePrinterCatalogCursor } from "../infrastructure/cursor.ts";
export { fingerprintPrinterCatalogQuery, InvalidPrinterCatalogQueryError, normalizePrinterCatalogQuery } from "../infrastructure/query.ts";
export { catalogComboLabels, catalogCompatibilityMachines, matchPrusaModel } from "../infrastructure/prusa-connect-match.ts";
export { catalogMaterialExists, catalogPublicMaterial, type CatalogPublicQuery } from "../infrastructure/catalog-public-read.ts";
export type { CatalogPublicMaterial } from "./catalog-public.ts";
import type { PrinterCatalogDetailResponse, PrinterCatalogListResponse } from "../../printers/public/index.ts";

export type CatalogJsonScalar = string | number | boolean | null;
export type CatalogJsonValue = CatalogJsonScalar | readonly CatalogJsonValue[] | CatalogJsonObject;
export interface CatalogJsonObject {
  readonly [key: string]: CatalogJsonValue;
}

export interface SlicerMachineRecord {
  readonly id: string;
  readonly specs: CatalogJsonObject;
}

export interface CatalogMachineSummary {
  readonly id: string;
  readonly kind: string;
  readonly vendor_id: string | null;
  readonly model: string;
  readonly specs: CatalogJsonObject;
}

export interface SlicerFilamentRecord {
  readonly id: string;
  readonly materialClass: string;
  readonly specs: CatalogJsonObject;
}

export interface CatalogMaterialDescription {
  readonly name: string;
  readonly brand: string;
  readonly material_type: string;
  readonly color_name: string | null;
  readonly color_hex: string | null;
}

export interface CompatibilityMaterialRecord {
  readonly materialType: string;
  readonly specs: CatalogJsonObject;
  readonly defaultExtruderTempC: number | null;
  readonly requiresChamber: boolean;
  readonly requiresDrying: boolean;
  readonly requiresDirectDrive: boolean;
}

export interface CatalogReadPort {
  machineForSlicer(id: string): Promise<SlicerMachineRecord | null>;
  machineSummary(id: string): Promise<CatalogMachineSummary | null>;
  filamentForSlicer(id: string): Promise<SlicerFilamentRecord | null>;
  machineExists(id: string): Promise<boolean>;
  vendorExists(id: string): Promise<boolean>;
  machineVendorId(id: string): Promise<string | null>;
  machineIdsForVendor(vendorId: string): Promise<readonly string[]>;
  filamentExists(id: string): Promise<boolean>;
  materialExists(id: string): Promise<boolean>;
  publicMaterial(id: string): Promise<CatalogPublicMaterial | null>;
  materialsExist(ids: readonly string[]): Promise<boolean>;
  variantBelongsToMaterial(variantId: string, materialId: string): Promise<boolean>;
  describeMaterial(materialId: string, variantId: string | null): Promise<CatalogMaterialDescription | null>;
  compatibilityMaterial(materialId: string): Promise<CompatibilityMaterialRecord | null>;
  vendorWebsites(ids: readonly string[]): Promise<ReadonlyMap<string, string | null>>;
  machineVendorWebsites(ids: readonly string[]): Promise<ReadonlyMap<string, string | null>>;
}

export interface CatalogMakeMachine {
  readonly id: string;
  readonly model: string;
}

export interface CatalogMakeMaterial {
  readonly id: string;
  readonly name: string;
}

export interface CatalogMakesPort {
  machine(id: string): Promise<CatalogMakeMachine | null>;
  materials(ids: readonly string[]): Promise<ReadonlyMap<string, CatalogMakeMaterial>>;
}

export interface CatalogQuery {
  readonly [key: string]: string | null | undefined;
  readonly status?: string;
  readonly from?: string;
  readonly to?: string;
  readonly cursor?: string;
  readonly limit?: string;
  readonly offset?: string;
  readonly vendor?: string;
  readonly type?: string;
  readonly kind?: string;
  readonly color?: string;
  readonly q?: string;
  readonly integration?: string;
  readonly brand?: string;
  readonly sort?: string;
  readonly currency?: string;
  readonly material_type?: string;
  readonly color_name?: string;
  readonly model?: string;
  readonly notes?: string | null;
}

export interface CatalogMakeStats {
  readonly make_count: number;
  readonly model_count: number;
}

export interface CatalogMakeSummary {
  readonly id: string;
  readonly created_at: Date;
  readonly caption: string | null;
  readonly printability_rating: number | null;
  readonly model: { readonly id: string; readonly title: string } | null;
  readonly user: {
    readonly id: string;
    readonly username: string;
    readonly display_name: string | null;
    readonly avatar_url: string | null;
  };
}

export interface CatalogMakeListing {
  readonly makes: readonly CatalogMakeSummary[];
  readonly has_more: boolean;
}

export interface CatalogExternalPort {
  machineMakes(
    machineId: string,
    limit: number,
    offset: number,
  ): Promise<{
    readonly stats: CatalogMakeStats;
    readonly listing: CatalogMakeListing;
  }>;
  materialMakes(
    materialId: string,
    limit: number,
    offset: number,
  ): Promise<{
    readonly stats: CatalogMakeStats;
    readonly listing: CatalogMakeListing;
  }>;
  printers(query: CatalogQuery): Promise<{ readonly ok: true; readonly body: PrinterCatalogListResponse } | { readonly ok: false }>;
  printer(slug: string): Promise<PrinterCatalogDetailResponse | null>;
  assertCandidateSuggestRateLimit(request: unknown, userId: string): Promise<void>;
  ensureCatalogCommunity(kind: "vendor" | "machine", subjectId: string, name: string): Promise<void>;
}

export interface CatalogReleaseResponse {
  readonly id: string;
  readonly machine_id: string | null;
  readonly vendor_id: string | null;
  readonly model_name: string;
  readonly status: string;
  readonly announced_at: string | null;
  readonly preorder_at: string | null;
  readonly ship_at: string | null;
  readonly eol_at: string | null;
  readonly source_url: string | null;
}

export interface CatalogReleasesResponse {
  readonly releases: readonly CatalogReleaseResponse[];
  readonly has_more: boolean;
  readonly next_cursor: string | null;
}

export interface CatalogVendorResponse {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly verified: boolean;
}

export interface CatalogMaterialTypeResponse {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
}

export interface CatalogMaterialVendorResponse {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
}

export interface CatalogMaterialResponse {
  readonly id: string;
  readonly craft: string;
  readonly kind: string;
  readonly slug: string;
  readonly name: string;
  readonly specs: CatalogJsonObject;
  readonly created_at: Date;
  readonly updated_at: Date;
  readonly vendor: CatalogMaterialVendorResponse;
  readonly material_type: CatalogMaterialTypeResponse;
}

export interface CatalogMaterialsResponse {
  readonly materials: readonly CatalogMaterialResponse[];
  readonly total: number;
  readonly limit: number;
  readonly offset: number;
  readonly has_more: boolean;
}

export interface CatalogMaterialVariantResponse {
  readonly id: string;
  readonly color_name: string;
  readonly color_hex: string | null;
  readonly diameter_mm: number;
  readonly weight_g: number | null;
  readonly spool_type: string | null;
  readonly sku: string | null;
  readonly specs: CatalogJsonObject;
  readonly created_at: Date;
}

export interface CatalogMaterialDetailResponse {
  readonly material: CatalogMaterialResponse & {
    readonly variants: readonly CatalogMaterialVariantResponse[];
    readonly make_stats: CatalogMakeStats;
  };
  readonly makes: readonly CatalogMakeSummary[];
  readonly makes_has_more: boolean;
}

export interface CatalogVendorsResponse {
  readonly vendors: readonly CatalogVendorResponse[];
}

export interface CatalogMachineVendorResponse {
  readonly id: string;
  readonly slug: string | null;
  readonly name: string | null;
}

export interface CatalogMachineResponse {
  readonly id: string;
  readonly craft: string;
  readonly kind: string;
  readonly vendor: CatalogMachineVendorResponse | null;
  readonly model: string;
  readonly aliases: readonly string[];
  readonly year: number | null;
  readonly discontinued: boolean;
  readonly specs: CatalogJsonObject;
  readonly integration: string;
  readonly source: string;
  readonly verified: boolean;
}

export interface CatalogMachinesResponse {
  readonly machines: readonly CatalogMachineResponse[];
  readonly has_more: boolean;
}

export interface CatalogMachineDetailResponse {
  readonly machine: CatalogMachineResponse & { readonly make_stats: CatalogMakeStats };
  readonly makes: readonly CatalogMakeSummary[];
  readonly makes_has_more: boolean;
}

export interface CatalogMetricsResponse {
  readonly total_models: number;
  readonly complete_specs_pct: number;
  readonly verified_pct: number;
  readonly median_freshness_days: number | null;
}

export interface CatalogCandidateResponse {
  readonly id: string;
  readonly source: string;
  readonly source_url: string | null;
  readonly external_ref: string;
  readonly raw: CatalogJsonValue;
  readonly matched_material_id?: string | null;
  readonly matched_machine_id?: string | null;
  readonly confidence: number | null;
  readonly status: string;
  readonly created_at: Date;
  readonly updated_at: Date;
  readonly matched_machine?: { readonly id: string; readonly model: string; readonly status: string } | null;
}

export interface CatalogCandidatePageResponse {
  readonly candidates: readonly CatalogCandidateResponse[];
  readonly status: string;
  readonly limit: number;
  readonly offset: number;
  readonly has_more: boolean;
}

export interface CatalogCandidateCreateResponse {
  readonly id: string;
  readonly status: "pending";
  readonly created_at: Date;
}

export type CatalogCandidateMutationResponse =
  | { readonly status: "merged"; readonly material_candidate_id: string; readonly material_id: string; readonly material_variant_id: string }
  | { readonly status: "merged"; readonly machine_candidate_id: string; readonly machine_id: string }
  | { readonly status: "rejected"; readonly material_candidate_id: string }
  | { readonly status: "rejected"; readonly machine_candidate_id: string };

export interface CatalogPort {
  releases(query: CatalogQuery): Promise<CatalogReleasesResponse>;
  materials(query: CatalogQuery): Promise<CatalogMaterialsResponse>;
  material(id: string, query: CatalogQuery): Promise<CatalogMaterialDetailResponse>;
  vendors(): Promise<CatalogVendorsResponse>;
  machines(query: CatalogQuery): Promise<CatalogMachinesResponse>;
  machine(id: string, query: CatalogQuery): Promise<CatalogMachineDetailResponse>;
  printers(query: CatalogQuery): Promise<PrinterCatalogListResponse>;
  printer(slug: string): Promise<PrinterCatalogDetailResponse>;
  metrics(): Promise<CatalogMetricsResponse>;
  materialCandidates(query: CatalogQuery): Promise<CatalogCandidatePageResponse>;
  suggestMaterialCandidate(userId: string, body: CatalogQuery, request: unknown): Promise<CatalogCandidateCreateResponse>;
  approveMaterialCandidate(id: string): Promise<CatalogCandidateMutationResponse>;
  rejectMaterialCandidate(id: string): Promise<CatalogCandidateMutationResponse>;
  machineCandidates(query: CatalogQuery): Promise<CatalogCandidatePageResponse>;
  suggestMachineCandidate(userId: string, body: CatalogQuery, request: unknown): Promise<CatalogCandidateCreateResponse>;
  approveMachineCandidate(id: string): Promise<CatalogCandidateMutationResponse>;
  rejectMachineCandidate(id: string): Promise<CatalogCandidateMutationResponse>;
}
import type { CatalogPublicMaterial } from "./catalog-public.ts";
