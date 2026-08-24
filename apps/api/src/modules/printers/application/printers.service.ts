import { randomUUID } from "node:crypto";
import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from "@nestjs/common";
import { isUUID } from "class-validator";
import type { UserId } from "../../_kernel/brandedIds.ts";
import { connectRecipe as legacyConnectRecipe, identify as identifyPrinter, type DeviceFacts } from "../public/connect.contract.ts";
import { LEAF_PROVENANCE_SECTIONS, SPEC_SECTIONS, deriveSlug, extractFacets, extractSpecs, isValidSlug, validatePrinterPayload, type PrinterFacets } from "../public/contract.ts";
import { InvalidRepoUrlError, validateRepoUrl } from "../../models/public/index.ts";
import { serializePrinter, type PrinterRow } from "../infrastructure/serialize.ts";
import { PrintersRepository, type PrinterReportRow } from "../infrastructure/printers.repository.ts";
import {
  PRINTER_ACTIVATION_PORT,
  PRINTER_ANALYTICS_PORT,
  PRINTER_CATALOG_MATCH_PORT,
  PRINTER_PRUSA_PORT,
  PRINTER_RESEARCH_AUTH_PORT,
  PRINTER_STORAGE_PORT,
  type PrinterActivationPort,
  type PrinterAnalyticsPort,
  type PrinterCatalogMatchPort,
  type CommunityFirmwarePageResponse,
  type CommunityFirmwareResponse,
  type PrinterCatalogDetailResponse,
  type PrinterConnectRecipeResponse,
  type PrinterDisconnectResponse,
  type PrinterIdentityResponse,
  type PrinterJsonValue,
  type PrinterPrusaStatusResponse,
  type PrinterPrusaSyncResponse,
  type PrinterReportApprovalResponse,
  type PrinterReportEnvelopeResponse,
  type PrinterReportsResponse,
  type PrinterResearchUploadResponse,
  type PrinterResearchConflictResponse,
  type PrinterResearchUpsertResponse,
  type PrinterPrusaPort,
  type PrinterResearchAuthPort,
  type PrintersPort,
  type PrinterStoragePort,
} from "../public/index.ts";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REPORTS_PER_DAY_LIMIT = 20;
const PHOTO_CONTENT_TYPES: Readonly<Record<string, string>> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
const ALLOWED_TOP_FIELDS = ["status", "kinematics", "type", "enclosed"] as const;
const ALLOWED_LEAF_SECTIONS = new Set<string>(LEAF_PROVENANCE_SECTIONS.filter((section) => section !== "media"));
const WRITABLE_COLUMN_FIELDS = ["brand", "model", "aliases", "released_at", "status", "kinematics", "type", "enclosed", "media"] as const;
const WRITABLE_FIELDS = [...WRITABLE_COLUMN_FIELDS, ...SPEC_SECTIONS] as const;
type WritableField = (typeof WRITABLE_FIELDS)[number];
const LEAF_SECTIONS = new Set<string>(LEAF_PROVENANCE_SECTIONS);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function printerJsonValue(value: unknown): PrinterJsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (Array.isArray(value)) return value.map(printerJsonValue);
  if (isPlainObject(value)) {
    const result: { [key: string]: PrinterJsonValue } = {};
    for (const [key, item] of Object.entries(value)) result[key] = printerJsonValue(item);
    return result;
  }
  return null;
}

function firmwareJson(row: {
  readonly id: string;
  readonly printer_id: string | null;
  readonly model: string;
  readonly author: string;
  readonly git_url: string;
  readonly verified: boolean;
  readonly created_at: Date;
  readonly updated_at: Date;
}) {
  return { ...row };
}

function reportJson(row: PrinterReportRow) {
  const { reporters: _reporters, ...result } = row;
  return result;
}

function invalid(): never {
  throw new UnprocessableEntityException();
}

function isAllowedReportField(field: string): boolean {
  if ((ALLOWED_TOP_FIELDS as readonly string[]).includes(field)) return true;
  const dot = field.indexOf(".");
  return dot > 0 && ALLOWED_LEAF_SECTIONS.has(field.slice(0, dot)) && field.slice(dot + 1).length > 0;
}

function stringField(source: Record<string, unknown>, key: string): string | undefined {
  const value = source[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function numberTriple(value: unknown): { x: number; y: number; z: number } | undefined {
  if (!isPlainObject(value)) return undefined;
  const x = Number(value.x);
  const y = Number(value.y);
  const z = Number(value.z);
  return [x, y, z].every((number) => Number.isFinite(number) && number > 0) ? { x, y, z } : undefined;
}

function readFacts(body: unknown): DeviceFacts {
  const source = isPlainObject(body) ? body : {};
  return {
    machine_type: stringField(source, "machine_type"),
    device_name: stringField(source, "device_name"),
    hostname: stringField(source, "hostname"),
    software_version: stringField(source, "software_version"),
    klipper_path: stringField(source, "klipper_path"),
    config_file: stringField(source, "config_file"),
    log_file: stringField(source, "log_file"),
    distribution: stringField(source, "distribution"),
    objects: Array.isArray(source.objects) ? source.objects.filter((item): item is string => typeof item === "string").slice(0, 500) : undefined,
    build_volume_mm: numberTriple(source.build_volume_mm),
    nozzle_diameter_mm: Array.isArray(source.nozzle_diameter_mm) ? source.nozzle_diameter_mm.filter((item): item is number => typeof item === "number").slice(0, 16) : undefined,
  };
}

function currentValue(existing: PrinterRow, field: WritableField): unknown {
  if ((WRITABLE_COLUMN_FIELDS as readonly string[]).includes(field)) return (existing as unknown as Record<string, unknown>)[field];
  return existing.specs[field] ?? null;
}

function effectiveShape(existing: PrinterRow | null, applied: Partial<Record<WritableField, unknown>>): Record<string, unknown> {
  const shape: Record<string, unknown> = {};
  for (const field of WRITABLE_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(applied, field)) shape[field] = applied[field];
    else if (existing !== null) shape[field] = currentValue(existing, field);
  }
  return shape;
}

function resolveSourceUrl(field: string, sources: readonly string[], fieldSources: Readonly<Record<string, unknown>>): string | null {
  const index = fieldSources[field];
  return typeof index === "number" && Number.isInteger(index) && sources[index] !== undefined ? sources[index] : (sources[0] ?? null);
}

@Injectable()
export class PrintersService implements PrintersPort {
  constructor(
    @Inject(PrintersRepository) private readonly repository: PrintersRepository,
    @Inject(PRINTER_RESEARCH_AUTH_PORT) private readonly researchAuth: PrinterResearchAuthPort,
    @Inject(PRINTER_PRUSA_PORT) private readonly prusa: PrinterPrusaPort,
    @Inject(PRINTER_CATALOG_MATCH_PORT) private readonly catalogMatch: PrinterCatalogMatchPort,
    @Inject(PRINTER_STORAGE_PORT) private readonly storage: PrinterStoragePort,
    @Inject(PRINTER_ANALYTICS_PORT) private readonly analytics: PrinterAnalyticsPort,
    @Inject(PRINTER_ACTIVATION_PORT) private readonly activation: PrinterActivationPort,
  ) {}

  async assertResearcher(userId: UserId): Promise<void> {
    if (!(await this.researchAuth.isResearcher(userId))) throw new ForbiddenException();
  }

  async communityFirmwareList(query: Readonly<Record<string, string | undefined>>): Promise<CommunityFirmwarePageResponse> {
    if (query.printer_id !== undefined && !isUUID(query.printer_id)) invalid();
    const limitNumber = Number(query.limit);
    const offsetNumber = Number(query.offset);
    const limit = Number.isFinite(limitNumber) && limitNumber > 0 ? Math.min(100, Math.floor(limitNumber)) : 24;
    const offset = Number.isFinite(offsetNumber) ? Math.max(0, Math.floor(offsetNumber)) : 0;
    const conditions: string[] = [];
    const values: unknown[] = [];
    if (query.model?.trim()) {
      values.push(query.model.trim());
      conditions.push(`lower(model)=lower($${values.length})`);
    }
    if (query.printer_id !== undefined) {
      values.push(query.printer_id);
      conditions.push(`printer_id=$${values.length}`);
    }
    values.push(limit + 1, offset);
    const result = await this.repository.communityFirmware(conditions.length > 0 ? `where ${conditions.join(" and ")}` : "", values);
    const hasMore = result.rows.length > limit;
    return { entries: result.rows.slice(0, limit).map(firmwareJson), limit, offset, has_more: hasMore };
  }

  async communityFirmwareCreate(userId: UserId, body: Readonly<Record<string, unknown>>): Promise<CommunityFirmwareResponse> {
    await this.assertResearcher(userId);
    if (typeof body.model !== "string" || !body.model.trim()) invalid();
    if (typeof body.author !== "string" || !body.author.trim()) invalid();
    if (typeof body.git_url !== "string" || !body.git_url.trim()) invalid();
    let gitUrl: string;
    try {
      gitUrl = validateRepoUrl(body.git_url.trim());
    } catch (error) {
      if (error instanceof InvalidRepoUrlError) return invalid();
      throw error;
    }
    if (body.printer_id !== undefined && (typeof body.printer_id !== "string" || !isUUID(body.printer_id))) invalid();
    const result = await this.repository.createCommunityFirmware([body.printer_id ?? null, body.model.trim(), body.author.trim(), gitUrl]);
    if (result.rows[0] === undefined) throw new ConflictException();
    return firmwareJson(result.rows[0]);
  }

  async communityFirmwareUpdate(userId: UserId, id: string, body: Readonly<Record<string, unknown>>): Promise<CommunityFirmwareResponse> {
    await this.assertResearcher(userId);
    if (!UUID_RE.test(id)) throw new NotFoundException();
    const sets: string[] = [];
    const values: unknown[] = [];
    const add = (field: string, value: unknown) => {
      values.push(value);
      sets.push(`${field}=$${values.length}`);
    };
    if (body.model !== undefined) {
      if (typeof body.model !== "string" || !body.model.trim()) invalid();
      add("model", body.model.trim());
    }
    if (body.author !== undefined) {
      if (typeof body.author !== "string" || !body.author.trim()) invalid();
      add("author", body.author.trim());
    }
    if (body.git_url !== undefined) {
      if (typeof body.git_url !== "string" || !body.git_url.trim()) invalid();
      try {
        add("git_url", validateRepoUrl(body.git_url.trim()));
      } catch (error) {
        if (error instanceof InvalidRepoUrlError) return invalid();
        throw error;
      }
    }
    if (body.verified !== undefined) {
      if (typeof body.verified !== "boolean") invalid();
      add("verified", body.verified);
    }
    if (body.printer_id !== undefined) {
      if (body.printer_id !== null && (typeof body.printer_id !== "string" || !isUUID(body.printer_id))) invalid();
      add("printer_id", body.printer_id);
    }
    if (sets.length === 0) invalid();
    try {
      const result = await this.repository.updateCommunityFirmware(id, sets, values);
      if (result.rows[0] === undefined) throw new NotFoundException();
      return firmwareJson(result.rows[0]);
    } catch (error) {
      if (isPlainObject(error) && error.code === "23505") throw new ConflictException();
      throw error;
    }
  }

  async communityFirmwareDelete(userId: UserId, id: string): Promise<void> {
    await this.assertResearcher(userId);
    if (!UUID_RE.test(id)) throw new NotFoundException();
    if ((await this.repository.deleteCommunityFirmware(id)).rowCount === 0) throw new NotFoundException();
  }

  connectRecipe(): PrinterConnectRecipeResponse {
    return legacyConnectRecipe();
  }

  async identify(body: unknown): Promise<PrinterIdentityResponse> {
    const facts = readFacts(body);
    const hasAnything = Object.values(facts).some((value) => (Array.isArray(value) ? value.length > 0 : value !== undefined));
    if (!hasAnything) throw new BadRequestException();
    return identifyPrinter(facts, (await this.repository.catalogPrinters()).rows);
  }

  async connectPrusa(userId: UserId, rawApiKey: unknown): Promise<PrinterPrusaSyncResponse> {
    if (typeof rawApiKey !== "string" || !rawApiKey.trim()) throw new BadRequestException();
    const remote = await this.prusa.listPrinters(rawApiKey.trim());
    if (!remote.ok) {
      if (remote.reason === "auth") throw new BadRequestException();
      throw new BadGatewayException();
    }
    const connection = await this.repository.upsertPrusaConnection(userId, this.prusa.encryptKey(rawApiKey.trim()));
    const matches = await Promise.all(remote.printers.map((printer) => this.catalogMatch.matchPrusaModel(printer.modelName)));
    const matched = await this.repository.transaction(async (tx) => {
      await this.activation.lockUser(userId, tx);
      const count = await this.repository.applyPrusaPrinters(userId, connection.rows[0]!.id, remote.printers, matches, tx);
      if (remote.printers.length > 0) await this.activation.setHasPrinter(userId, true, tx);
      return count;
    });
    return { connected: true, printers_found: remote.printers.length, printers_matched: matched };
  }

  async syncPrusa(userId: UserId): Promise<PrinterPrusaSyncResponse> {
    const connection = (await this.repository.prusaConnection(userId)).rows[0];
    if (connection === undefined) throw new NotFoundException();
    const apiKey = this.prusa.decryptKey(connection.api_key_enc);
    if (apiKey === null) {
      await this.repository.updatePrusaConnection(connection.id, "error", "decrypt failed, reconnect required");
      throw new BadGatewayException();
    }
    const remote = await this.prusa.listPrinters(apiKey);
    if (!remote.ok) {
      await this.repository.updatePrusaConnection(connection.id, "error", remote.reason);
      if (remote.reason === "auth") throw new BadRequestException();
      throw new BadGatewayException();
    }
    const matches = await Promise.all(remote.printers.map((printer) => this.catalogMatch.matchPrusaModel(printer.modelName)));
    const matched = await this.repository.transaction(async (tx) => {
      await this.activation.lockUser(userId, tx);
      const count = await this.repository.applyPrusaPrinters(userId, connection.id, remote.printers, matches, tx);
      if (remote.printers.length > 0) await this.activation.setHasPrinter(userId, true, tx);
      return count;
    });
    await this.repository.updatePrusaConnection(connection.id, "active", null);
    return { connected: true, printers_found: remote.printers.length, printers_matched: matched };
  }

  async prusaStatus(userId: UserId): Promise<PrinterPrusaStatusResponse> {
    const row = (await this.repository.prusaConnection(userId)).rows[0];
    return row === undefined ? { connected: false } : { connected: true, status: row.status, last_synced_at: row.last_synced_at, last_error: row.last_error };
  }

  async disconnectPrusa(userId: UserId): Promise<PrinterDisconnectResponse> {
    return { ok: ((await this.repository.disconnectPrusa(userId)).rowCount ?? 0) > 0 };
  }

  async researchUpsert(userId: UserId, anonId: string, body: Readonly<Record<string, unknown>>): Promise<{ status: 200 | 201; body: PrinterResearchUpsertResponse }> {
    await this.assertResearcher(userId);
    const { errors } = validatePrinterPayload(body);
    if (errors.length > 0) invalid();
    const brand = (body.brand as string).trim();
    const model = (body.model as string).trim();
    const slugInput = (body.slug as string | undefined) ?? (body.id as string | undefined);
    const slug = slugInput?.trim() || deriveSlug(brand, model);
    const meta = body._meta as Record<string, unknown>;
    const filledBy = (meta.filled_by as string).trim();
    const confidence = meta.confidence as string;
    const now = new Date();
    const sourcesIncoming = Array.isArray(body.sources) ? body.sources.filter((source): source is string => typeof source === "string" && source.trim().length > 0) : [];
    const fieldSources = isPlainObject(body.field_sources) ? body.field_sources : {};
    const resolveConflicts = new Set(Array.isArray(body.resolve_conflicts) ? body.resolve_conflicts : []);
    const baseUpdatedAt = typeof meta.base_updated_at === "string" ? new Date(meta.base_updated_at) : null;
    const result = await this.repository.transaction(async (tx) => {
      const existing = (await this.repository.findPrinter(slug, tx, true)).rows[0] ?? null;
      const applied: Partial<Record<WritableField, unknown>> = {};
      const conflicts: PrinterResearchConflictResponse[] = [];
      const leafPaths: string[] = [];
      for (const field of WRITABLE_FIELDS) {
        if (!Object.prototype.hasOwnProperty.call(body, field) || body[field] === undefined) continue;
        const incoming = body[field];
        if (LEAF_SECTIONS.has(field) && isPlainObject(incoming)) {
          const current = existing === null ? {} : currentValue(existing, field);
          const currentSection = isPlainObject(current) ? current : {};
          const merged = { ...currentSection };
          for (const [leaf, value] of Object.entries(incoming)) {
            const path = `${field}.${leaf}`;
            const provenance = existing?.field_provenance[path] as { ts?: string } | undefined;
            if (
              existing !== null &&
              baseUpdatedAt !== null &&
              !resolveConflicts.has(path) &&
              provenance?.ts !== undefined &&
              new Date(provenance.ts) > baseUpdatedAt &&
              JSON.stringify(currentSection[leaf] ?? null) !== JSON.stringify(value ?? null)
            ) {
              conflicts.push({ field: path, ours: printerJsonValue(currentSection[leaf] ?? null), theirs: printerJsonValue(value) });
              continue;
            }
            merged[leaf] = value;
            leafPaths.push(path);
          }
          applied[field] = merged;
          continue;
        }
        const provenance = existing?.field_provenance[field] as { ts?: string } | undefined;
        if (
          existing !== null &&
          baseUpdatedAt !== null &&
          !resolveConflicts.has(field) &&
          provenance?.ts !== undefined &&
          new Date(provenance.ts) > baseUpdatedAt &&
          JSON.stringify(currentValue(existing, field)) !== JSON.stringify(incoming)
        ) {
          conflicts.push({ field, ours: printerJsonValue(currentValue(existing, field)), theirs: printerJsonValue(incoming) });
          continue;
        }
        applied[field] = incoming;
      }
      const effective = effectiveShape(existing, applied);
      const facets: PrinterFacets = extractFacets(effective);
      const specs = extractSpecs(effective);
      const mergedSources = [...new Set([...(existing?.sources ?? []), ...sourcesIncoming])];
      const provenance = { ...(existing?.field_provenance ?? {}) } as Record<string, unknown>;
      for (const field of Object.keys(applied))
        if (!LEAF_SECTIONS.has(field))
          provenance[field] = { source_url: resolveSourceUrl(field, sourcesIncoming, fieldSources), filled_by: filledBy, ts: now.toISOString(), confidence };
      for (const path of leafPaths)
        provenance[path] = { source_url: resolveSourceUrl(path, sourcesIncoming, fieldSources), filled_by: filledBy, ts: now.toISOString(), confidence };
      const gaps = Array.isArray(meta.gaps) ? (meta.gaps as string[]) : (existing?.gaps ?? []);
      const reviewedBy = typeof meta.reviewed_by === "string" && meta.reviewed_by.trim() ? meta.reviewed_by.trim() : (existing?.reviewed_by ?? null);
      const aliases = Array.isArray(effective.aliases) ? effective.aliases.filter((item): item is string => typeof item === "string") : (existing?.aliases ?? []);
      const values = [
        slug,
        brand,
        model,
        aliases,
        (effective.released_at as string | undefined) ?? existing?.released_at ?? null,
        (effective.status as string | undefined) ?? existing?.status ?? "announced",
        (effective.kinematics as string | undefined) ?? existing?.kinematics ?? null,
        (effective.type as string | undefined) ?? existing?.type ?? null,
        effective.enclosed !== undefined ? effective.enclosed : (existing?.enclosed ?? null),
        facets.build_volume_x,
        facets.build_volume_y,
        facets.build_volume_z,
        facets.hotend_max_temp_c,
        facets.hotend_max_flow_mm3s,
        facets.hotend_hardened,
        facets.bed_max_temp_c,
        facets.bed_auto_leveling,
        facets.multimaterial_supported,
        facets.has_laser,
        facets.has_cnc,
        facets.nozzle_swappable,
        facets.moonraker,
        facets.lan_mode,
        facets.price_msrp_usd,
        facets.price_ru_rub,
        facets.price_ru_updated_at,
        JSON.stringify(specs),
        JSON.stringify(isPlainObject(effective.media) ? effective.media : (existing?.media ?? {})),
        mergedSources,
        JSON.stringify(provenance),
        confidence,
        filledBy,
        reviewedBy,
        gaps,
        reviewedBy !== null,
      ];
      const upserted = await tx.query<PrinterRow>(
        `insert into printers (slug,brand,model,aliases,released_at,status,kinematics,type,enclosed,build_volume_x,build_volume_y,build_volume_z,
          hotend_max_temp_c,hotend_max_flow_mm3s,hotend_hardened,bed_max_temp_c,bed_auto_leveling,multimaterial_supported,has_laser,has_cnc,nozzle_swappable,
          moonraker,lan_mode,price_msrp_usd,price_ru_rub,price_ru_updated_at,specs,media,sources,field_provenance,confidence,filled_by,reviewed_by,gaps,verified,schema_version)
         values (${values.map((_, index) => `$${index + 1}`).join(",")},'1.0') on conflict (slug) do update set
          brand=excluded.brand,model=excluded.model,aliases=excluded.aliases,released_at=excluded.released_at,status=excluded.status,kinematics=excluded.kinematics,type=excluded.type,enclosed=excluded.enclosed,
          build_volume_x=excluded.build_volume_x,build_volume_y=excluded.build_volume_y,build_volume_z=excluded.build_volume_z,hotend_max_temp_c=excluded.hotend_max_temp_c,
          hotend_max_flow_mm3s=excluded.hotend_max_flow_mm3s,hotend_hardened=excluded.hotend_hardened,bed_max_temp_c=excluded.bed_max_temp_c,bed_auto_leveling=excluded.bed_auto_leveling,
          multimaterial_supported=excluded.multimaterial_supported,has_laser=excluded.has_laser,has_cnc=excluded.has_cnc,nozzle_swappable=excluded.nozzle_swappable,moonraker=excluded.moonraker,
          lan_mode=excluded.lan_mode,price_msrp_usd=excluded.price_msrp_usd,price_ru_rub=excluded.price_ru_rub,price_ru_updated_at=excluded.price_ru_updated_at,
          specs=excluded.specs,media=excluded.media,sources=excluded.sources,field_provenance=excluded.field_provenance,confidence=excluded.confidence,filled_by=excluded.filled_by,
          reviewed_by=excluded.reviewed_by,gaps=excluded.gaps,verified=excluded.verified,updated_at=now() returning *`,
        values,
      );
      return { row: upserted.rows[0]!, conflicts, isNew: existing === null };
    });
    void this.analytics
      .printerUpserted({
        anonId,
        userId,
        printerId: result.row.id,
        slug: result.row.slug,
        brand: result.row.brand,
        model: result.row.model,
        confidence: result.row.confidence,
        gapsCount: result.row.gaps.length,
        sourcesCount: result.row.sources.length,
        filledBy: result.row.filled_by,
        isNew: result.isNew,
      })
      .catch(() => undefined);
    return { status: result.isNew ? 201 : 200, body: { printer: serializePrinter(result.row), conflicts: result.conflicts, draft: result.row.sources.length === 0 } };
  }

  async researchDetail(userId: UserId, slug: string): Promise<PrinterCatalogDetailResponse> {
    await this.assertResearcher(userId);
    const row = (await this.repository.findPrinterBySlug(slug)).rows[0];
    if (row === undefined) throw new NotFoundException();
    return { printer: serializePrinter(row) };
  }

  async researchUpload(userId: UserId, slug: unknown, contentType: unknown): Promise<PrinterResearchUploadResponse> {
    await this.assertResearcher(userId);
    if (typeof slug !== "string" || !isValidSlug(slug)) invalid();
    const extension = typeof contentType === "string" ? PHOTO_CONTENT_TYPES[contentType] : undefined;
    if (extension === undefined) invalid();
    const key = `printers/${slug}/media/${Date.now()}-${randomUUID()}.${extension}`;
    const uploadUrl = await this.storage.uploadUrl(key, contentType as string);
    if (uploadUrl === null) throw new ServiceUnavailableException();
    return { upload_url: uploadUrl, key };
  }

  async researchMedia(userId: UserId, key: string): Promise<string> {
    await this.assertResearcher(userId);
    if (!key) throw new NotFoundException();
    const url = await this.storage.objectUrl(key);
    if (url === null) throw new ServiceUnavailableException();
    return url;
  }

  async report(userId: UserId, idOrSlug: string, body: Readonly<Record<string, unknown>>): Promise<PrinterReportEnvelopeResponse> {
    if (typeof body.field !== "string" || !isAllowedReportField(body.field)) invalid();
    const note = typeof body.note === "string" ? body.note.trim().slice(0, 2000) : null;
    const proposed = Object.prototype.hasOwnProperty.call(body, "proposed_value") ? (body.proposed_value ?? null) : null;
    if (!note && proposed === null) invalid();
    const printer = (await this.repository.findPrinter(idOrSlug)).rows[0];
    if (printer === undefined) throw new NotFoundException();
    if (Number((await this.repository.reportCount(userId)).rows[0]!.count) >= REPORTS_PER_DAY_LIMIT) throw new HttpException("", HttpStatus.TOO_MANY_REQUESTS);
    const row = (await this.repository.upsertReport(printer.id, body.field, note, proposed, userId)).rows[0]!;
    return { report: reportJson(row) };
  }

  async reports(userId: UserId, status: string | undefined): Promise<PrinterReportsResponse> {
    await this.assertResearcher(userId);
    const normalized = status !== undefined && ["pending", "approved", "rejected"].includes(status) ? status : "pending";
    const result = await this.repository.listReports(normalized);
    return { reports: result.rows.map((row) => ({ ...reportJson(row), printer: { slug: row.slug, brand: row.brand, model: row.model } })) };
  }

  async rejectReport(userId: UserId, reportId: string): Promise<PrinterReportEnvelopeResponse> {
    await this.assertResearcher(userId);
    const row = (await this.repository.resolveReport(reportId, userId, "rejected")).rows[0];
    if (row === undefined) throw new NotFoundException();
    return { report: reportJson(row) };
  }

  async approveReport(userId: UserId, reportId: string): Promise<PrinterReportApprovalResponse> {
    await this.assertResearcher(userId);
    return this.repository.transaction(async (tx) => {
      const report = (await this.repository.lockReport(reportId, tx)).rows[0];
      if (report === undefined) throw new NotFoundException();
      if (report.proposed_value === null || report.proposed_value === undefined) {
        await this.repository.resolveReport(report.id, userId, "approved", tx);
        return { report: reportJson({ ...report, status: "approved" }), applied: false };
      }
      const printer = (await this.repository.findPrinter(report.printer_id, tx, true)).rows[0];
      if (printer === undefined) throw new NotFoundException();
      const provenance = {
        ...printer.field_provenance,
        [report.field]: { source_url: null, filled_by: `community:${report.reporters[0] ?? userId}`, ts: new Date().toISOString(), confidence: "low" },
      };
      const dot = report.field.indexOf(".");
      if (dot === -1) {
        if (!(ALLOWED_TOP_FIELDS as readonly string[]).includes(report.field)) throw new ConflictException();
        await tx.query(`update printers set ${report.field}=$2,field_provenance=$3,updated_at=now() where id=$1`, [printer.id, report.proposed_value, JSON.stringify(provenance)]);
      } else {
        const section = report.field.slice(0, dot);
        const leaf = report.field.slice(dot + 1);
        const specs = { ...printer.specs };
        specs[section] = { ...(isPlainObject(specs[section]) ? specs[section] : {}), [leaf]: report.proposed_value };
        const effective: Record<string, unknown> = {};
        for (const name of SPEC_SECTIONS) effective[name] = specs[name] ?? {};
        const facets = extractFacets(effective);
        await tx.query(
          `update printers set specs=$2,field_provenance=$3,build_volume_x=$4,build_volume_y=$5,build_volume_z=$6,hotend_max_temp_c=$7,
           hotend_max_flow_mm3s=$8,hotend_hardened=$9,bed_max_temp_c=$10,bed_auto_leveling=$11,multimaterial_supported=$12,has_laser=$13,
           has_cnc=$14,nozzle_swappable=$15,moonraker=$16,lan_mode=$17,price_msrp_usd=$18,price_ru_rub=$19,price_ru_updated_at=$20,updated_at=now() where id=$1`,
          [
            printer.id,
            JSON.stringify(specs),
            JSON.stringify(provenance),
            facets.build_volume_x,
            facets.build_volume_y,
            facets.build_volume_z,
            facets.hotend_max_temp_c,
            facets.hotend_max_flow_mm3s,
            facets.hotend_hardened,
            facets.bed_max_temp_c,
            facets.bed_auto_leveling,
            facets.multimaterial_supported,
            facets.has_laser,
            facets.has_cnc,
            facets.nozzle_swappable,
            facets.moonraker,
            facets.lan_mode,
            facets.price_msrp_usd,
            facets.price_ru_rub,
            facets.price_ru_updated_at,
          ],
        );
      }
      await this.repository.resolveReport(report.id, userId, "approved", tx);
      const updated = (await this.repository.findPrinter(printer.id, tx)).rows[0]!;
      return { report: reportJson({ ...report, status: "approved" }), applied: true, printer: serializePrinter(updated) };
    });
  }
}
