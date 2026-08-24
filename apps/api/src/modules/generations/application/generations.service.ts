import { randomUUID } from "node:crypto";
import { HttpException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { Request } from "express";
import { GenerationId, type UserId } from "../../_kernel/brandedIds.ts";
import { MODEL_OWNER_PORT, type ModelOwnerPort } from "../../models/public/index.ts";
import {
  branchHealth,
  CONCEPT_LABEL_MAX_LENGTH,
  CONCEPT_LIST_DEFAULT_LIMIT,
  CONCEPT_LIST_MAX_CURSOR,
  CONCEPT_LIST_MAX_LIMIT,
  CONCEPT_MOTIF_MAX_LENGTH,
  CONCEPT_QUERY_MAX_LENGTH,
  conceptCacheKey,
  generationAssetContentType,
  generationAssetExtension,
  generationRequestFingerprint,
  isConceptAngle,
  isGenerationBranch,
  isGenerationParameters,
  isPromptBlocked,
  isUuid,
  MAX_SCAN_PHOTO_BYTES,
  MAX_SCAN_PHOTOS,
  MIN_SCAN_PHOTOS,
  normalizeConceptQuery,
  normalizeIdempotencyKey,
  normalizeOptionalText,
  PARAMS_MAX_JSON_BYTES,
  PROMPT_MAX_LENGTH,
  scanPhotoPrefix,
  toConceptCard,
  toGenerationResponse,
  type ConceptAngle,
  type ConceptRow,
  type GenerationRow,
  type GenerationParameters,
} from "../domain/generations.ts";
import { GenerationsRepository } from "../infrastructure/generations.repository.ts";
import {
  GENERATIONS_EXTERNAL_PORT,
  type AssetResult,
  type GenerationHealthResponse,
  type GenerationOutcome,
  type GenerationsExternalPort,
  type GenerationsPort,
} from "../public/index.ts";

function fail(status: number): never {
  throw new HttpException({}, status);
}
function draftTitle(prompt: string): string {
  return prompt.trim().slice(0, 200) || "Generation";
}
const FUNCTIONAL_QUERY_RE = /(держател|подставк|органайзер|креплен|кронштейн|крюч|стойк|док-станц)/iu;
const WORD_RE = /[\p{L}\p{N}]+/gu;
const STOP_WORDS = new Set(["без", "в", "во", "для", "из", "к", "как", "на", "над", "о", "от", "по", "под", "при", "про", "с", "со", "у"]);
const ACTION_RE =
  /^(?:дела(?:ет|ют)|лет(?:ит|ят)|прыг(?:ает|ают)|перепрыг(?:ивает|ивают)|беж(?:ит|ат)|сид(?:ит|ят)|сто(?:ит|ят)|танцу(?:ет|ют)|ед(?:ет|ут)|ката(?:ется|ются)|ныря(?:ет|ют)|пар(?:ит|ят)|игра(?:ет|ют)|нес(?:ёт|ут)|держ(?:ит|ат))$/iu;
const ADJECTIVE_RE = /(?:ый|ий|ой|ая|яя|ое|ее|ые|ие|ого|его|ому|ему|ым|им|ую|юю|ых|их)$/iu;
const HEALTH_WINDOW_HOURS = 24;

function subjectAnchor(query: string): string | null {
  if (!/[а-яё]/iu.test(query)) return null;
  const words = (query.match(WORD_RE) ?? []).filter((word) => word.length >= 3 && !STOP_WORDS.has(word) && !ACTION_RE.test(word));
  const subject = words.find((word) => !ADJECTIVE_RE.test(word)) ?? words[0];
  if (subject === undefined) return null;
  const normalized = subject.replaceAll("ё", "е");
  return normalized.length <= 4 ? normalized : normalized.slice(0, 4);
}
function keepsSubject(query: string, row: ConceptRow): boolean {
  const anchor = subjectAnchor(query);
  if (anchor === null) return true;
  return [row.normalized_query, row.label, row.prompt, row.motif ?? ""].join(" ").toLocaleLowerCase("ru").replaceAll("ё", "е").includes(anchor);
}

interface CreateOutcome extends GenerationOutcome {
  readonly row?: GenerationRow;
}

@Injectable()
export class GenerationsService implements GenerationsPort {
  constructor(
    @Inject(GenerationsRepository) private readonly repository: GenerationsRepository,
    @Inject(GENERATIONS_EXTERNAL_PORT) private readonly external: GenerationsExternalPort,
    @Inject(MODEL_OWNER_PORT) private readonly models: ModelOwnerPort,
  ) {}

  async health(): Promise<GenerationHealthResponse> {
    const rows = await this.repository.healthRows();
    return { window_hours: HEALTH_WINDOW_HOURS, branches: ["openscad", "trellis", "concepts", "kzd", "hueforge", "scan"].map((branch) => branchHealth(branch, rows)) };
  }

  createScan(_userId: UserId) {
    if (!this.external.storageConfigured()) fail(503);
    return { id: randomUUID() };
  }

  async uploadScanPhoto(userId: UserId, scanId: string, file: { readonly buffer: Buffer; readonly truncated?: boolean }) {
    if (!isUuid(scanId)) fail(422);
    if (file.truncated === true || file.buffer.length > MAX_SCAN_PHOTO_BYTES) fail(413);
    if (this.external.detectImage(file.buffer) === null) fail(422);
    const prefix = scanPhotoPrefix(userId, scanId);
    const count = await this.external.countPhotos(prefix);
    if (count >= MAX_SCAN_PHOTOS) fail(409);
    await this.external.putObject(`${prefix}${String(count).padStart(4, "0")}.jpg`, file.buffer, "image/jpeg");
    return { photos: count + 1 };
  }

  async uploadScanManifest(userId: UserId, scanId: string, body: Record<string, unknown>) {
    if (!isUuid(scanId)) fail(422);
    const center = body.center;
    const radius = body.radius;
    const floor = body.floor;
    const top = body.top;
    if (center !== undefined && (!Array.isArray(center) || center.length !== 3 || !center.every((n) => typeof n === "number" && Number.isFinite(n)))) fail(422);
    if (radius !== undefined && (typeof radius !== "number" || !Number.isFinite(radius) || radius <= 0 || radius > 2)) fail(422);
    if (floor !== undefined && (typeof floor !== "number" || !Number.isFinite(floor) || Math.abs(floor) > 10)) fail(422);
    if (top !== undefined && (typeof top !== "number" || !Number.isFinite(top) || Math.abs(top) > 10)) fail(422);
    if (typeof floor === "number" && typeof top === "number" && top <= floor) fail(422);
    const photos = body.photos;
    if (typeof photos !== "object" || photos === null || Array.isArray(photos)) fail(422);
    const entries = Object.entries(photos);
    if (entries.length === 0 || entries.length > MAX_SCAN_PHOTOS) fail(422);
    for (const [name, value] of entries)
      if (!/^\d{4}\.jpg$/.test(name) || !Array.isArray(value) || value.length !== 3 || !value.every((n) => typeof n === "number" && Number.isFinite(n))) fail(422);
    if (!this.external.storageConfigured()) fail(503);
    const manifest = {
      photos,
      ...(center !== undefined ? { center } : {}),
      ...(radius !== undefined ? { radius } : {}),
      ...(floor !== undefined ? { floor } : {}),
      ...(top !== undefined ? { top } : {}),
    };
    await this.external.putObject(`${scanPhotoPrefix(userId, scanId)}manifest.json`, Buffer.from(JSON.stringify(manifest)), "application/json");
    return { photos: entries.length };
  }

  async startScan(userId: UserId, scanId: string, rawMode: unknown) {
    if (!isUuid(scanId)) fail(422);
    const mode = rawMode ?? "photogrammetry";
    if (mode !== "photogrammetry" && mode !== "neural") fail(422);
    const storageId = `${userId}/${scanId}`;
    const existing = await this.repository.findStartedScan(userId, storageId);
    if (existing !== null) return { status: 200, body: { generation: toGenerationResponse(existing) } };
    const photos = await this.external.countPhotos(scanPhotoPrefix(userId, scanId));
    const required = mode === "neural" ? 2 : MIN_SCAN_PHOTOS;
    if (photos < required) fail(422);
    return this.createInternal({
      userId,
      branch: "scan",
      prompt: mode === "neural" ? `Нейро-набросок предмета — ${photos} ракурса` : `Съёмка предмета — ${photos} кадров`,
      params: { scan_id: storageId, photos, mode },
      assistantOfferId: null,
      sourceGenerationId: null,
      sourceAngles: undefined,
    });
  }

  async detail(userId: UserId, generationId: string) {
    if (!isUuid(generationId)) throw new NotFoundException();
    const found = await this.repository.findOwned(generationId, userId);
    if (found === null) throw new NotFoundException();
    const row = await this.repository.resolveStale(found);
    return { generation: toGenerationResponse(row, await this.repository.queuePosition(row)) };
  }

  async list(userId: UserId) {
    const rows = await Promise.all((await this.repository.listOwned(userId)).map((row) => this.repository.resolveStale(row)));
    return { generations: await Promise.all(rows.map(async (row) => toGenerationResponse(row, await this.repository.queuePosition(row)))) };
  }

  async listConcepts(query: { readonly q?: string; readonly limit?: string; readonly cursor?: string }) {
    const limit = Number(query.limit ?? CONCEPT_LIST_DEFAULT_LIMIT);
    if (!Number.isInteger(limit) || limit < 1 || limit > CONCEPT_LIST_MAX_LIMIT) fail(422);
    const cursor = Number(query.cursor ?? 0);
    if (!Number.isInteger(cursor) || cursor < 0 || cursor > CONCEPT_LIST_MAX_CURSOR) fail(422);
    if (query.q === undefined) {
      const window = await this.repository.globalConcepts(cursor, limit + 1);
      return { query: null, concepts: window.slice(0, limit).map(toConceptCard), next_cursor: window.length > limit ? String(cursor + limit) : null, degraded: false };
    }
    if (query.q.trim().length < 2) fail(422);
    const normalized = normalizeConceptQuery(query.q);
    if (normalized.length > CONCEPT_QUERY_MAX_LENGTH) fail(413);
    const windowSize = cursor + limit + 1;
    const functional = FUNCTIONAL_QUERY_RE.test(normalized);
    const exact = await this.repository.exactQueryConcepts(normalized, windowSize, functional);
    if (exact.length > cursor) {
      const concepts = exact.slice(cursor, cursor + limit);
      return { query: normalized, concepts: concepts.map(toConceptCard), next_cursor: concepts.length > 0 ? String(cursor + concepts.length) : null, degraded: false };
    }
    const embedding = await this.external.embed(normalized, 1_500);
    const exactIds = new Set(exact.map((row) => row.id));
    const candidateSize = Math.min(windowSize + 48, windowSize * 4);
    const semantic = (embedding ? await this.repository.semanticConcepts(this.external.vectorLiteral(embedding), candidateSize, functional) : [])
      .filter((row) => !exactIds.has(row.id) && keepsSubject(normalized, row))
      .slice(0, Math.max(0, windowSize - exact.length));
    const remaining = windowSize - exact.length - semantic.length;
    const lexical =
      remaining > 0
        ? (await this.repository.lexicalConcepts(normalized, Math.min(remaining + 48, remaining * 4), [...exactIds, ...semantic.map((row) => row.id)], functional))
            .filter((row) => keepsSubject(normalized, row))
            .slice(0, remaining)
        : [];
    const window = [...exact, ...semantic, ...lexical];
    const concepts = window.slice(cursor, cursor + limit);
    return { query: normalized, concepts: concepts.map(toConceptCard), next_cursor: window.length > cursor + limit ? String(cursor + limit) : null, degraded: embedding === null };
  }

  async conceptPreview(conceptId: string): Promise<AssetResult> {
    if (!isUuid(conceptId)) throw new NotFoundException();
    const key = await this.repository.conceptPreviewKey(conceptId);
    if (key === null) throw new NotFoundException();
    const object = await this.external.getObject(key);
    if (object === null) throw new NotFoundException();
    return { key, object, contentType: generationAssetContentType(key), cacheControl: "public, max-age=86400, stale-while-revalidate=604800" };
  }

  async createConcept(userId: UserId, body: Record<string, unknown>, rawKey: unknown) {
    const key = this.validIdempotency(rawKey);
    const { query, label, prompt } = body;
    const motif = normalizeOptionalText(body.motif, CONCEPT_MOTIF_MAX_LENGTH);
    if (typeof query !== "string" || !query.trim() || query.trim().length > CONCEPT_QUERY_MAX_LENGTH) fail(422);
    if (typeof label !== "string" || !label.trim() || label.trim().length > CONCEPT_LABEL_MAX_LENGTH) fail(422);
    if (typeof prompt !== "string" || !prompt.trim() || prompt.trim().length > PROMPT_MAX_LENGTH) fail(422);
    if (motif === undefined) fail(422);
    const normalizedQuery = normalizeConceptQuery(query);
    const normalizedLabel = label.trim().replace(/\s+/g, " ");
    const normalizedPrompt = prompt.trim();
    const cacheKey = conceptCacheKey({ normalizedQuery, label: normalizedLabel, prompt: normalizedPrompt, motif });
    return this.repository.withConceptLock(cacheKey, async (client) => {
      const exact = await this.repository.exactConcept(client, cacheKey);
      if (exact !== null && !["failed", "error", "timed_out"].includes(exact.status) && !["error", "timed_out"].includes(exact.generation_status)) {
        const card = toConceptCard(await this.repository.reuseConcept(client, exact));
        return { status: card.status === "ready" ? 200 : 202, body: { concept: card, cached: true } };
      }
      const embedding = await this.external.embed([normalizedQuery, normalizedLabel, normalizedPrompt, motif].filter(Boolean).join(". "));
      const outcome = await this.createInternal({
        userId,
        branch: "concepts",
        prompt: normalizedPrompt,
        params: { normalized_query: normalizedQuery, label: normalizedLabel, motif, cache_key: cacheKey, render_profile: "white-plastic-v1" },
        assistantOfferId: null,
        sourceGenerationId: null,
        sourceAngles: undefined,
        idempotencyKey: key,
      });
      if (outcome.status >= 400) return outcome;
      const generation = outcome.body.generation as { id?: unknown } | undefined;
      if (typeof generation?.id !== "string") throw new Error("concept generation response missing id");
      const row = await this.repository.insertConcept(client, {
        generationId: generation.id,
        normalizedQuery,
        label: normalizedLabel,
        prompt: normalizedPrompt,
        motif,
        cacheKey,
        embeddingLiteral: embedding ? this.external.vectorLiteral(embedding) : null,
      });
      return { status: 201, body: { concept: toConceptCard(row), generation: outcome.body.generation, cached: false } };
    });
  }

  async generationAsset(userId: UserId, generationId: string, kind: "preview" | "artifact" | "preview_shot", angle: string | undefined, request: Request): Promise<AssetResult> {
    await this.external.assertDownloadRateLimit(request, userId);
    if (!isUuid(generationId)) throw new NotFoundException();
    const row = await this.repository.assetOwner(generationId);
    if (row === null || row.user_id !== userId) throw new NotFoundException();
    const key =
      kind === "preview"
        ? row.preview_url
        : kind === "artifact"
          ? row.artifact_url
          : isConceptAngle(angle)
            ? (row.preview_shots?.find((shot) => shot.angle === angle)?.s3_key ?? null)
            : null;
    if (key === null) throw new NotFoundException();
    const object = await this.external.getObject(key);
    if (object === null) throw new NotFoundException();
    if (kind === "artifact") await this.external.emitDownloaded({ generationId: GenerationId(row.id), userId, branch: row.branch });
    return { key, object, contentType: generationAssetContentType(key), cacheControl: "private, max-age=3600" };
  }

  async catalogDraft(userId: UserId, generationId: string) {
    if (!isUuid(generationId)) throw new NotFoundException();
    const prepared = await this.repository.transaction(async (client) => {
      const generation = await this.repository.ownedDoneForUpdate(client, generationId, userId);
      if (generation === null) throw new NotFoundException();
      const existing = await this.models.findGenerationDraft(generation.id, client);
      if (existing !== null) return { kind: "replay" as const, model: existing };
      const sourceFormat =
        generation.branch === "trellis"
          ? generation.artifact_url && generationAssetExtension(generation.artifact_url) === "stl"
            ? "stl"
            : null
          : generation.branch === "openscad"
            ? "stl"
            : generation.branch === "hueforge"
              ? "zip"
              : null;
      if (sourceFormat === null || generation.artifact_url === null) fail(422);
      if (!this.external.modelsStorageConfigured()) fail(503);
      const modelId = await this.models.createGenerationDraft(client, { ownerId: userId, title: draftTitle(generation.prompt), sourceFormat, sourceGenerationId: generation.id });
      return { kind: "created" as const, modelId, sourceFormat, generation };
    });
    if (prepared.kind === "replay") return { status: 200, body: { model: prepared.model } };
    const { modelId, sourceFormat, generation } = prepared;
    try {
      const source = await this.external.copyToModel({ generationKey: generation.artifact_url as string, modelId, role: "source" });
      if (source === null) {
        await this.models.deleteModel(modelId);
        throw new NotFoundException();
      }
      await this.models.addModelFile({ modelId, role: "source", ...source });
      if (generation.preview_url !== null) {
        const preview = await this.external.copyToModel({ generationKey: generation.preview_url, modelId, role: "preview" });
        if (preview !== null) await this.models.addModelFile({ modelId, role: "preview", ...preview });
      }
      return { status: 201, body: { model: { id: modelId, title: draftTitle(generation.prompt), source_format: sourceFormat, status: "ready", craft: "3d_printing" } } };
    } catch (error) {
      await this.models.deleteModel(modelId).catch(() => undefined);
      if (error instanceof NotFoundException) throw error;
      fail(500);
    }
  }

  create(userId: UserId, body: Record<string, unknown>, rawKey: unknown) {
    const key = this.validIdempotency(rawKey);
    if (body.branch === "concepts") fail(422);
    if (body.assistant_offer_id !== undefined && typeof body.assistant_offer_id !== "string") fail(422);
    if (body.source_generation_id !== undefined && typeof body.source_generation_id !== "string") fail(422);
    return this.createInternal({
      userId,
      branch: body.branch,
      prompt: body.prompt,
      params: body.params,
      assistantOfferId: body.assistant_offer_id ?? null,
      sourceGenerationId: body.source_generation_id ?? null,
      sourceAngles: body.source_angles,
      idempotencyKey: key,
    });
  }

  private validIdempotency(raw: unknown): string | undefined {
    if (raw === undefined) return undefined;
    const normalized = normalizeIdempotencyKey(raw);
    if (normalized === null) fail(400);
    return normalized;
  }

  private async createInternal(input: {
    readonly userId: UserId;
    readonly branch: unknown;
    readonly prompt: unknown;
    readonly params: unknown;
    readonly assistantOfferId: string | null;
    readonly sourceGenerationId: string | null;
    readonly sourceAngles: unknown;
    readonly idempotencyKey?: string;
  }): Promise<CreateOutcome> {
    if (!isGenerationBranch(input.branch)) fail(422);
    if (input.assistantOfferId !== null && !isUuid(input.assistantOfferId)) fail(422);
    if (typeof input.prompt !== "string" || input.prompt.trim().length === 0) fail(422);
    const prompt = input.prompt.trim();
    if (prompt.length > PROMPT_MAX_LENGTH) fail(413);
    if (isPromptBlocked(prompt)) fail(422);
    let params: GenerationParameters = {};
    if (input.params !== undefined) {
      if (!isGenerationParameters(input.params)) fail(422);
      const serialized = JSON.stringify(input.params);
      if (Buffer.byteLength(serialized, "utf8") > PARAMS_MAX_JSON_BYTES) fail(413);
      params = input.params;
    }
    let source: { readonly generationId: string; readonly angles: readonly ConceptAngle[] } | null = null;
    if (input.sourceGenerationId !== null) {
      if (!isUuid(input.sourceGenerationId)) fail(422);
      if (!Array.isArray(input.sourceAngles) || input.sourceAngles.length === 0) fail(422);
      const uniqueAngles: unknown[] = [...new Set<unknown>(input.sourceAngles)];
      const angles = uniqueAngles.filter(isConceptAngle);
      if (uniqueAngles.length !== input.sourceAngles.length || angles.length !== uniqueAngles.length) fail(422);
      const sourceRow = await this.repository.sourceConcept(input.sourceGenerationId);
      if (sourceRow === null || sourceRow.user_id !== input.userId) throw new NotFoundException();
      if (sourceRow.branch !== "concepts" || sourceRow.status !== "done") fail(409);
      const available = new Set((sourceRow.preview_shots ?? []).map((shot) => shot.angle));
      if (angles.some((angle) => !available.has(angle))) fail(422);
      source = { generationId: input.sourceGenerationId, angles };
    }
    const fingerprint = input.idempotencyKey ? generationRequestFingerprint(input.branch, prompt, params, source) : undefined;
    const result = await this.repository.create({
      userId: input.userId,
      branch: input.branch,
      prompt,
      params,
      assistantOfferId: input.assistantOfferId,
      source,
      ...(input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {}),
      ...(fingerprint ? { requestFingerprint: fingerprint } : {}),
    });
    if (result.kind === "idempotency_conflict") fail(409);
    if (result.kind === "hourly_limit" || result.kind === "daily_limit") fail(429);
    if (result.kind === "replayed") return { status: result.status, body: result.body };
    const body = { generation: toGenerationResponse(result.row, result.queuePosition) };
    await this.external.emitStarted({
      generationId: GenerationId(result.row.id),
      userId: input.userId,
      branch: result.row.branch,
      ...(result.row.assistant_offer_id ? { assistantOfferId: result.row.assistant_offer_id } : {}),
      ...(result.row.source_generation_id ? { sourceGenerationId: result.row.source_generation_id } : {}),
    });
    return { status: 201, body, row: result.row };
  }
}
