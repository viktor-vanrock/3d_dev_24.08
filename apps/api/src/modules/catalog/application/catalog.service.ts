import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException, UnprocessableEntityException } from "@nestjs/common";
import {
  decodeReleaseCursor,
  encodeReleaseCursor,
  parseCatalogLimit,
  parseCatalogOffset,
  parseMachineLimit,
  parseMaterialKind,
  parseReleaseDate,
  parseReleaseLimit,
  parseReleaseStatuses,
  percentage,
  queryString,
  UUID_RE,
} from "../domain/catalog.ts";
import { CatalogReadRepository, type CatalogMachineRow, type CatalogMaterialRow, type CatalogMaterialVariantRow } from "../infrastructure/catalog-read.repository.ts";
import {
  CATALOG_EXTERNAL_PORT,
  type CatalogCandidateCreateResponse,
  type CatalogCandidateMutationResponse,
  type CatalogCandidatePageResponse,
  type CatalogCandidateResponse,
  type CatalogExternalPort,
  type CatalogMachineDetailResponse,
  type CatalogMachinesResponse,
  type CatalogMaterialDetailResponse,
  type CatalogMaterialsResponse,
  type CatalogMetricsResponse,
  type CatalogPort,
  type CatalogQuery,
  type CatalogReleasesResponse,
  type CatalogVendorsResponse,
} from "../public/index.ts";
import type { PrinterCatalogDetailResponse, PrinterCatalogListResponse } from "../../printers/public/index.ts";
import { CatalogCandidatesRepository, type CandidateMutation, type CandidateRow } from "../infrastructure/catalog-candidates.repository.ts";

const MATERIAL_CANDIDATE_STATUSES = ["pending", "matched", "merged", "rejected", "quarantined"] as const;
const MACHINE_CANDIDATE_STATUSES = ["pending", "quarantined"] as const;

function candidateJson(row: CandidateRow): CatalogCandidateResponse {
  return { ...row, confidence: row.confidence === null ? null : Number(row.confidence) };
}

function isMaterialCandidateStatus(value: string): value is (typeof MATERIAL_CANDIDATE_STATUSES)[number] {
  return MATERIAL_CANDIDATE_STATUSES.some((status) => status === value);
}

function isMachineCandidateStatus(value: string): value is (typeof MACHINE_CANDIDATE_STATUSES)[number] {
  return MACHINE_CANDIDATE_STATUSES.some((status) => status === value);
}

function requiredText(value: unknown, max: number): string | null {
  return typeof value === "string" && value.trim() !== "" && value.length <= max ? value.trim() : null;
}

function optionalNotes(value: unknown): string | null | undefined {
  if (value === undefined || value === null) return null;
  return typeof value === "string" && value.length <= 1000 ? value.trim() || null : undefined;
}

function materialJson(row: CatalogMaterialRow) {
  return {
    id: row.id,
    craft: row.craft,
    kind: row.kind,
    slug: row.slug,
    name: row.name,
    specs: row.specs,
    created_at: row.created_at,
    updated_at: row.updated_at,
    vendor: { id: row.vendor_id, slug: row.vendor_slug, name: row.vendor_name },
    material_type: { id: row.material_type_id, slug: row.material_type_slug, name: row.material_type_name },
  };
}

function variantJson(row: CatalogMaterialVariantRow) {
  return {
    id: row.id,
    color_name: row.color_name,
    color_hex: row.color_hex,
    diameter_mm: Number(row.diameter_mm),
    weight_g: row.weight_g,
    spool_type: row.spool_type,
    sku: row.sku,
    specs: row.specs,
    created_at: row.created_at,
  };
}

function machineJson(row: CatalogMachineRow) {
  return {
    id: row.id,
    craft: row.craft,
    kind: row.kind,
    vendor: row.vendor_id === null ? null : { id: row.vendor_id, slug: row.vendor_slug, name: row.vendor_name },
    model: row.model,
    aliases: row.aliases,
    year: row.year,
    discontinued: row.discontinued,
    specs: row.specs,
    integration: row.integration,
    source: row.source,
    verified: row.verified,
  };
}

@Injectable()
export class CatalogService implements CatalogPort {
  constructor(
    @Inject(CatalogReadRepository) private readonly repository: CatalogReadRepository,
    @Inject(CatalogCandidatesRepository) private readonly candidates: CatalogCandidatesRepository,
    @Inject(CATALOG_EXTERNAL_PORT) private readonly external: CatalogExternalPort,
  ) {}

  async releases(query: CatalogQuery): Promise<CatalogReleasesResponse> {
    const limit = parseReleaseLimit(query.limit);
    const rows = await this.repository.releases({
      statuses: parseReleaseStatuses(query.status),
      from: parseReleaseDate(query.from),
      to: parseReleaseDate(query.to),
      cursor: decodeReleaseCursor(query.cursor),
      limit,
    });
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const last = page[page.length - 1];
    return {
      releases: page.map(({ event_date: _eventDate, ...release }) => release),
      has_more: hasMore,
      next_cursor: hasMore && last !== undefined ? encodeReleaseCursor([last.event_date, last.id]) : null,
    };
  }

  async materials(query: CatalogQuery): Promise<CatalogMaterialsResponse> {
    const limit = parseCatalogLimit(query.limit);
    const offset = parseCatalogOffset(query.offset);
    const result = await this.repository.materials({
      vendor: queryString(query.vendor).trim(),
      type: queryString(query.type).trim().toLowerCase(),
      kind: parseMaterialKind(query.kind),
      color: queryString(query.color).trim(),
      query: queryString(query.q).trim().slice(0, 200),
      limit,
      offset,
    });
    const hasMore = result.rows.length > limit;
    return {
      materials: (hasMore ? result.rows.slice(0, limit) : result.rows).map(materialJson),
      total: result.total,
      limit,
      offset,
      has_more: hasMore,
    };
  }

  async material(id: string, query: CatalogQuery): Promise<CatalogMaterialDetailResponse> {
    if (!UUID_RE.test(id)) throw new NotFoundException();
    const row = await this.repository.material(id);
    if (row === null) throw new NotFoundException();
    const limit = parseCatalogLimit(query.limit);
    const offset = parseCatalogOffset(query.offset);
    const [variants, makes] = await Promise.all([this.repository.materialVariants(id), this.external.materialMakes(id, limit, offset)]);
    return {
      material: { ...materialJson(row), variants: variants.map(variantJson), make_stats: makes.stats },
      makes: makes.listing.makes,
      makes_has_more: makes.listing.has_more,
    };
  }

  async vendors(): Promise<CatalogVendorsResponse> {
    return { vendors: await this.repository.vendors() };
  }

  async machines(query: CatalogQuery): Promise<CatalogMachinesResponse> {
    const limit = parseMachineLimit(query.limit);
    const rows = await this.repository.machines({
      vendor: queryString(query.vendor).trim(),
      kind: queryString(query.kind).trim(),
      integration: queryString(query.integration).trim(),
      query: queryString(query.q).trim().slice(0, 200),
      limit,
      offset: parseCatalogOffset(query.offset),
    });
    const hasMore = rows.length > limit;
    return { machines: (hasMore ? rows.slice(0, limit) : rows).map(machineJson), has_more: hasMore };
  }

  async machine(id: string, query: CatalogQuery): Promise<CatalogMachineDetailResponse> {
    if (!UUID_RE.test(id)) throw new NotFoundException();
    const row = await this.repository.machine(id);
    if (row === null) throw new NotFoundException();
    const limit = parseMachineLimit(query.limit);
    const makes = await this.external.machineMakes(id, limit, parseCatalogOffset(query.offset));
    return {
      machine: { ...machineJson(row), make_stats: makes.stats },
      makes: makes.listing.makes,
      makes_has_more: makes.listing.has_more,
    };
  }

  async printers(query: CatalogQuery): Promise<PrinterCatalogListResponse> {
    const result = await this.external.printers(query);
    if (!result.ok) throw new BadRequestException();
    return result.body;
  }

  async printer(slug: string): Promise<PrinterCatalogDetailResponse> {
    const result = await this.external.printer(slug);
    if (result === null) throw new NotFoundException();
    return result;
  }

  async metrics(): Promise<CatalogMetricsResponse> {
    const row = await this.repository.metrics();
    const total = Number(row.total_models);
    return {
      total_models: total,
      complete_specs_pct: percentage(Number(row.complete_count), total),
      verified_pct: percentage(Number(row.verified_count), total),
      median_freshness_days: row.median_freshness_days === null ? null : Math.round(row.median_freshness_days * 10) / 10,
    };
  }

  async materialCandidates(query: CatalogQuery): Promise<CatalogCandidatePageResponse> {
    const rawStatus = queryString(query.status);
    const status = isMaterialCandidateStatus(rawStatus) ? rawStatus : "pending";
    const limit = parseCatalogLimit(query.limit);
    const offset = parseCatalogOffset(query.offset);
    const rows = await this.candidates.materialCandidates(status, limit, offset);
    const hasMore = rows.length > limit;
    return { candidates: (hasMore ? rows.slice(0, limit) : rows).map(candidateJson), status, limit, offset, has_more: hasMore };
  }

  async suggestMaterialCandidate(userId: string, body: CatalogQuery, request: unknown): Promise<CatalogCandidateCreateResponse> {
    await this.external.assertCandidateSuggestRateLimit(request, userId);
    const vendor = requiredText(body.vendor, 200);
    const materialType = requiredText(body.material_type, 200);
    const colorName = requiredText(body.color_name, 200);
    const notes = optionalNotes(body.notes);
    if (vendor === null || materialType === null || colorName === null || notes === undefined) throw new UnprocessableEntityException();
    const row = await this.candidates.createMaterialCandidate(userId, { vendor, materialType, colorName, notes });
    return { id: row.id, status: "pending", created_at: row.created_at };
  }

  async approveMaterialCandidate(id: string): Promise<CatalogCandidateMutationResponse> {
    return this.mutation(id, () => this.candidates.approveMaterialCandidate(id));
  }
  async rejectMaterialCandidate(id: string): Promise<CatalogCandidateMutationResponse> {
    return this.mutation(id, () => this.candidates.rejectCandidate("material_candidates", id, ["pending"]));
  }

  async machineCandidates(query: CatalogQuery): Promise<CatalogCandidatePageResponse> {
    const rawStatus = queryString(query.status);
    const selected = isMachineCandidateStatus(rawStatus) ? [rawStatus] : [...MACHINE_CANDIDATE_STATUSES];
    const limit = parseCatalogLimit(query.limit);
    const offset = parseCatalogOffset(query.offset);
    const rows = await this.candidates.machineCandidates(selected, limit, offset);
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const ids = [...new Set(page.map((row) => row.matched_machine_id).filter((id): id is string => id !== null && id !== undefined))];
    const machines = await this.candidates.candidateMachines(ids);
    return {
      candidates: page.map((row) => ({
        ...candidateJson(row),
        matched_machine: row.matched_machine_id
          ? ((machine) => (machine ? { id: machine.id, model: machine.model, status: machine.status } : null))(machines.get(row.matched_machine_id))
          : null,
      })),
      status: selected.length === 1 ? rawStatus : "all",
      limit,
      offset,
      has_more: hasMore,
    };
  }

  async suggestMachineCandidate(userId: string, body: CatalogQuery, request: unknown): Promise<CatalogCandidateCreateResponse> {
    await this.external.assertCandidateSuggestRateLimit(request, userId);
    const vendor = requiredText(body.vendor, 200);
    const model = requiredText(body.model, 200);
    const notes = optionalNotes(body.notes);
    if (vendor === null || model === null || notes === undefined) throw new UnprocessableEntityException();
    const row = await this.candidates.createMachineCandidate(userId, { vendor, model, notes });
    return { id: row.id, status: "pending", created_at: row.created_at };
  }

  async approveMachineCandidate(id: string): Promise<CatalogCandidateMutationResponse> {
    const result = await this.mutation(id, () => this.candidates.approveMachineCandidate(id), true);
    return result;
  }
  async rejectMachineCandidate(id: string): Promise<CatalogCandidateMutationResponse> {
    return this.mutation(id, () => this.candidates.rejectCandidate("machine_candidates", id, MACHINE_CANDIDATE_STATUSES));
  }

  private async mutation(id: string, operation: () => Promise<CandidateMutation>, community = false): Promise<CatalogCandidateMutationResponse> {
    if (!UUID_RE.test(id)) throw new NotFoundException();
    const result = await operation();
    if (result.kind === "not_found") throw new NotFoundException();
    if (result.kind === "not_pending") throw new ConflictException();
    if (result.kind === "unmergeable" || result.kind === "matched_machine_missing") throw new UnprocessableEntityException();
    if (community && result.community !== undefined) {
      await this.external.ensureCatalogCommunity("vendor", result.community.vendorId, result.community.vendorName);
      await this.external.ensureCatalogCommunity("machine", result.community.machineId, `${result.community.vendorName} ${result.community.model}`);
    }
    return result.body;
  }
}
