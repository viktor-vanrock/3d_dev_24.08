import { randomUUID } from "node:crypto";
import { HttpException, Inject, Injectable, Logger, NotFoundException } from "@nestjs/common";
import {
  PROMPT_VARIANTS_CONTEXTS,
  PROMPT_VARIANTS_CONTRACT_VERSION,
  PROMPT_VARIANTS_DEFAULT_LIMIT,
  PROMPT_VARIANTS_EXCLUDE_LABEL_MAX_LENGTH,
  PROMPT_VARIANTS_EXCLUDE_MAX_ITEMS,
  PROMPT_VARIANTS_MAX_BATCH,
  PROMPT_VARIANTS_MAX_LIMIT,
  PROMPT_VARIANTS_MIN_LIMIT,
  PROMPT_VARIANTS_QUERY_MAX_LENGTH,
} from "@portal/contracts/http/prompt-variants";
import type { Request } from "express";
import type { UserId } from "../../_kernel/brandedIds.ts";
import {
  assistantRunSsePollMs,
  assistantThreadSsePollMs,
  CLIENT_REQUEST_ID_MAX_LENGTH,
  isUuid,
  MESSAGE_CONTENT_MAX_LENGTH,
  parseLimit,
  THREAD_TITLE_MAX_LENGTH,
  toMessageResponse,
  toRunResponse,
  toRunSseFrame,
  toThreadResponse,
  toThreadSseFrame,
} from "../domain/assistant.ts";
import { AssistantRepository } from "../infrastructure/assistant.repository.ts";
import {
  ASSISTANT_EXTERNAL_PORT,
  ASSISTANT_GENERATIONS_PORT,
  type AssistantEventStream,
  type AssistantExternalPort,
  type AssistantGenerationsPort,
  type AssistantPort,
  type AssistantPromptVariant,
  type AssistantPromptVariantsResponse,
} from "../public/index.ts";

const GENERATION_BRANCHES = ["openscad", "kzd", "hueforge", "trellis", "concepts", "scan"] as const;
const FUNCTIONAL_QUERY_RE = /(держател|подставк|органайзер|креплен|кронштейн|крюч|стойк|док-станц)/iu;
const FUNCTIONAL_PROMPT_GUARD_MARKER = "Пустая опорная конструкция — главный объект";
const QUERY_WORD_RE = /[\p{L}\p{N}]+/gu;
const QUERY_ANCHOR_STOP_WORDS = new Set(["без", "был", "была", "быть", "для", "его", "или", "как", "над", "под", "при", "про", "свой", "стиле", "чтобы", "это"]);

function fail(status: number): never {
  throw new HttpException({}, status);
}
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
function sentenceCase(value: string): string {
  return value.length === 0 ? value : `${value[0]!.toLocaleUpperCase("ru")}${value.slice(1)}`;
}
function queryAnchor(value: string): string {
  const normalized = value.toLocaleLowerCase("ru").replaceAll("ё", "е");
  return normalized.length <= 3 ? normalized : normalized.slice(0, normalized.length === 4 ? 3 : 4);
}
function hashSeed(value: string): number {
  let hash = 2_166_136_261;
  for (const character of value) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
}
function isResumeId(raw: unknown): { readonly resume: boolean; readonly cursor: number } {
  const items: readonly unknown[] = Array.isArray(raw) ? (raw as readonly unknown[]) : [];
  const value = typeof raw === "string" ? raw : items[0];
  const cursor = value === undefined ? Number.NaN : Number(value);
  return Number.isFinite(cursor) && cursor >= 0 ? { resume: true, cursor } : { resume: false, cursor: 0 };
}

function strengthenFunctionalPrompt(query: string, prompt: string): string {
  return !FUNCTIONAL_QUERY_RE.test(query) || prompt.includes(FUNCTIONAL_PROMPT_GUARD_MARKER)
    ? prompt
    : `${sentenceCase(query)}. ${FUNCTIONAL_PROMPT_GUARD_MARKER}: ${query}. Показать конструкцию целиком и без предмета, который она держит, хранит или поддерживает. ${prompt}`;
}

function keepsQuerySubject(query: string, label: string, prompt: string): boolean {
  if (!/[а-яё]/iu.test(query)) return true;
  const words = (query.toLocaleLowerCase("ru").match(QUERY_WORD_RE) ?? []).filter((word) => word.length >= 3 && !QUERY_ANCHOR_STOP_WORDS.has(word));
  const anchors = words.map(queryAnchor);
  if (anchors.length === 0) return true;
  const candidate = `${label} ${prompt}`.toLocaleLowerCase("ru").replaceAll("ё", "е");
  const functionalAnchors = words.filter((word) => FUNCTIONAL_QUERY_RE.test(word)).map(queryAnchor);
  return functionalAnchors.length > 0 ? functionalAnchors.every((anchor) => candidate.includes(anchor)) : anchors.some((anchor) => candidate.includes(anchor));
}

interface HeuristicPreset {
  readonly labelTail: string;
  readonly prompt: string;
  readonly motif: "decor" | "functional" | "figure";
}
interface HeuristicComposition {
  readonly labelTail: string;
  readonly prompt: string;
}

function heuristicVariants(
  query: string,
  requestId: string,
  limit: number,
  batch: number,
  excludeLabels: readonly string[],
): Array<AssistantPromptVariant & { readonly id: string }> {
  const firstBatch: readonly HeuristicPreset[] = [
    { labelTail: "из силуэтов котиков", prompt: "узор из силуэтов котиков, лапок и плавно переплетённых хвостов, читаемый круговой ритм", motif: "decor" },
    { labelTail: "с меандром Древнего Рима", prompt: "римский меандр, лавровые ветви и ритм античных архитектурных фризов", motif: "decor" },
    { labelTail: "японских волн", prompt: "многоуровневый узор с волнами сэйгайха и спокойной асимметрией японской гравюры", motif: "decor" },
    { labelTail: "в ритме ар-деко", prompt: "веерные лучи, ступенчатые арки и контрастная симметрия в духе ар-деко", motif: "decor" },
    { labelTail: "как ботанический атлас", prompt: "рельефный гербарий из листьев папоротника, семенных коробочек и тонких стеблей", motif: "decor" },
    { labelTail: "с картой созвездий", prompt: "сетка созвездий с тонкими связями, звёздными узлами и одной выразительной орбитой", motif: "decor" },
  ];
  const laterThemes: readonly HeuristicPreset[] = [
    { labelTail: "с солнечными знаками майя", prompt: "ступенчатый орнамент и солнечные знаки архитектуры майя", motif: "decor" },
    { labelTail: "с морским бестиарием", prompt: "ритм из медуз, морских коньков и коралловых ветвей", motif: "figure" },
    { labelTail: "как пиксельный сад", prompt: "геометрический узор из пиксельных цветов и листьев", motif: "decor" },
    { labelTail: "северных рун", prompt: "плетёный северный орнамент с руническим ритмом без текста", motif: "decor" },
    { labelTail: "механического роя", prompt: "узор из миниатюрных шестерён, сот и механических жуков", motif: "functional" },
    { labelTail: "облаков и журавлей", prompt: "воздушный восточный мотив из облаков и летящих журавлей", motif: "decor" },
    { labelTail: "коралловых рифов", prompt: "органический рельеф из коралловых колоний и морских вееров", motif: "figure" },
    { labelTail: "с оптической иллюзией", prompt: "непрерывный геометрический рельеф с эффектом невозможных лестниц", motif: "decor" },
    { labelTail: "сказочного леса", prompt: "узор из грибов, желудей, папоротников и крошечных дверей", motif: "figure" },
    { labelTail: "как киберпанк-схема", prompt: "слоистые дорожки печатной платы и световые техно-узлы", motif: "functional" },
    { labelTail: "в стиле русского модерна", prompt: "текучий цветочный орнамент и вытянутые линии русского модерна", motif: "decor" },
    { labelTail: "с лунными фазами", prompt: "последовательность лунных фаз, кратеров и тонких орбит", motif: "decor" },
  ];
  const compositions: readonly HeuristicComposition[] = [
    { labelTail: "", prompt: "" },
    { labelTail: "в спиральном ритме", prompt: "композиция закручивается по спирали" },
    { labelTail: "с крупным центральным медальоном", prompt: "в центре расположен крупный смысловой медальон" },
    { labelTail: "в виде непрерывной ленты", prompt: "мотив складывается в непрерывную круговую ленту" },
    { labelTail: "с чередованием крупных и мелких деталей", prompt: "крупные элементы ритмично чередуются с мелкими" },
    { labelTail: "в диагональной композиции", prompt: "мотив развивается по выразительной диагонали" },
    { labelTail: "с зеркальной симметрией", prompt: "композиция построена на ясной зеркальной симметрии" },
    { labelTail: "в ритме мозаики", prompt: "элементы собраны в плотный мозаичный ритм" },
    { labelTail: "с одним намеренным разрывом", prompt: "непрерывный орнамент имеет один выразительный разрыв" },
    { labelTail: "как многослойный барельеф", prompt: "детали образуют многослойный барельеф разной глубины" },
    { labelTail: "с узором, растущим снизу вверх", prompt: "плотность деталей постепенно растёт снизу вверх" },
    { labelTail: "в свободной асимметрии", prompt: "композиция держится на уравновешенной свободной асимметрии" },
  ];
  const shortQuery = query.length > 64 ? `${query.slice(0, 61)}...` : query;
  const excluded = new Set(excludeLabels.map((label) => label.toLocaleLowerCase("ru")));
  const candidates: Array<HeuristicPreset & { readonly composition: HeuristicComposition }> =
    batch === 0
      ? firstBatch.map((preset) => ({ ...preset, composition: compositions[0]! }))
      : Array.from({ length: laterThemes.length * compositions.length }, (_, index) => {
          const shuffled = (hashSeed(`${requestId}:${batch}`) + index * 37) % (laterThemes.length * compositions.length);
          return { ...laterThemes[shuffled % laterThemes.length]!, composition: compositions[Math.floor(shuffled / laterThemes.length)]! };
        });
  const variants: Array<AssistantPromptVariant & { readonly id: string }> = [];
  for (const candidate of candidates) {
    if (variants.length >= limit) break;
    const label = sentenceCase(`${shortQuery} ${candidate.labelTail}${candidate.composition.labelTail ? ` ${candidate.composition.labelTail}` : ""}`);
    if (excluded.has(label.toLocaleLowerCase("ru"))) continue;
    variants.push({
      id: `${requestId}-fallback-${variants.length}`,
      label,
      prompt: strengthenFunctionalPrompt(
        query,
        `${sentenceCase(query)}: ${candidate.prompt}${candidate.composition.prompt ? `; ${candidate.composition.prompt}` : ""}. Цельная форма, пригодная для 3D-печати.`,
      ),
      motif: candidate.motif,
      confidence: 0,
    });
  }
  return variants;
}

@Injectable()
export class AssistantService implements AssistantPort {
  private readonly logger = new Logger(AssistantService.name);
  constructor(
    @Inject(AssistantRepository) private readonly repository: AssistantRepository,
    @Inject(ASSISTANT_EXTERNAL_PORT) private readonly external: AssistantExternalPort,
    @Inject(ASSISTANT_GENERATIONS_PORT) private readonly generations: AssistantGenerationsPort,
  ) {}

  async createThread(userId: UserId, rawTitle: unknown) {
    if (rawTitle !== undefined && rawTitle !== null && typeof rawTitle !== "string") fail(422);
    const title = typeof rawTitle === "string" && rawTitle.trim().length > 0 ? rawTitle.trim() : null;
    if (title !== null && title.length > THREAD_TITLE_MAX_LENGTH) fail(422);
    return { thread: toThreadResponse(await this.repository.createThread(userId, title)) };
  }

  async listThreads(userId: UserId, query: Readonly<Record<string, unknown>>) {
    const limit = parseLimit(query.limit, 24, 60);
    const cursor = typeof query.cursor === "string" && query.cursor ? query.cursor : null;
    const rows = await this.repository.listThreads(userId, cursor, limit);
    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    const last = items.at(-1);
    return { items: items.map(toThreadResponse), next_cursor: hasMore && last ? last.created_at.toISOString() : null };
  }

  async threadDetail(userId: UserId, threadId: string) {
    return { thread: toThreadResponse(await this.requireThread(userId, threadId)) };
  }
  async markThreadRead(userId: UserId, threadId: string) {
    const thread = await this.requireThread(userId, threadId);
    return { thread: toThreadResponse(await this.repository.markRead(thread.id)) };
  }

  async listMessages(userId: UserId, threadId: string, query: Readonly<Record<string, unknown>>) {
    const thread = await this.requireThread(userId, threadId);
    const limit = parseLimit(query.limit, 30, 100);
    const cursor = typeof query.cursor === "string" && query.cursor ? query.cursor : null;
    const rows = await this.repository.listMessages(thread.id, cursor, limit);
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const oldest = page.at(-1);
    return { items: [...page].reverse().map(toMessageResponse), next_cursor: hasMore && oldest ? oldest.created_at.toISOString() : null };
  }

  async createMessage(userId: UserId, threadId: string, body: Readonly<Record<string, unknown>>) {
    const thread = await this.requireThread(userId, threadId);
    const content = body.content;
    const requestId = body.client_request_id;
    if (typeof content !== "string" || content.trim().length === 0) fail(422);
    const normalizedContent = content.trim();
    if (normalizedContent.length > MESSAGE_CONTENT_MAX_LENGTH) fail(413);
    if (typeof requestId !== "string" || requestId.trim().length === 0) fail(422);
    const normalizedRequestId = requestId.trim();
    if (normalizedRequestId.length > CLIENT_REQUEST_ID_MAX_LENGTH) fail(422);
    const result = await this.repository.createMessage(thread, normalizedContent, normalizedRequestId);
    if (result.kind === "idempotency_conflict") fail(409);
    if (result.kind === "hourly_limit" || result.kind === "daily_limit") fail(429);
    if (result.kind !== "created" && result.kind !== "replayed") throw new Error("unknown assistant message outcome");
    const status: 200 | 201 = result.kind === "created" ? 201 : 200;
    return { status, body: { message: toMessageResponse(result.message), run: result.run === null ? null : toRunResponse(result.run) } };
  }

  async runDetail(userId: UserId, threadId: string, runId: string) {
    const thread = await this.requireThread(userId, threadId);
    if (!isUuid(runId)) throw new NotFoundException();
    const found = await this.repository.runInThread(runId, thread.id);
    if (found === null) throw new NotFoundException();
    const row = await this.repository.resolveStale(found);
    return { run: toRunResponse(row, await this.repository.queueInfo(row)) };
  }

  async openThreadEvents(userId: UserId, threadId: string, lastEventId: unknown, signal: AbortSignal): Promise<AssistantEventStream> {
    const thread = await this.requireThread(userId, threadId);
    const initial = isResumeId(lastEventId);
    const external = this.external;
    const logger = this.logger;
    return {
      frames: (async function* () {
        let cursor = initial.cursor;
        if (!initial.resume)
          yield `event: thread.snapshot\ndata: ${JSON.stringify({ thread_id: thread.id, kind: thread.kind, severity: thread.severity, incident_status: thread.incident_status, read_at: thread.read_at })}\n\n`;
        while (!signal.aborted) {
          try {
            const events = await external.loadThreadEventsAfter(thread.id, cursor);
            for (const event of events) {
              yield toThreadSseFrame(event);
              cursor = event.seq;
            }
          } catch {
            logger.warn("assistant thread SSE tick failed");
          }
          if (!signal.aborted) await sleep(assistantThreadSsePollMs());
        }
      })(),
    };
  }

  async openRunEvents(userId: UserId, runId: string, lastEventId: unknown, signal: AbortSignal): Promise<AssistantEventStream> {
    if (!isUuid(runId)) throw new NotFoundException();
    let initialRow = await this.repository.ownedRun(runId, userId);
    if (initialRow === null) throw new NotFoundException();
    initialRow = await this.repository.resolveStale(initialRow);
    const initial = isResumeId(lastEventId);
    const repository = this.repository;
    const logger = this.logger;
    return {
      frames: (async function* () {
        let row = initialRow;
        let cursor = initial.cursor;
        if (!initial.resume) yield `event: assistant.snapshot\ndata: ${JSON.stringify({ run: toRunResponse(row, await repository.queueInfo(row)) })}\n\n`;
        while (!signal.aborted) {
          try {
            const events = await repository.ensureRunEvents(row);
            let terminal = false;
            for (const event of events) {
              if (event.seq <= cursor) continue;
              yield toRunSseFrame(event);
              cursor = event.seq;
              terminal ||= event.event_type === "assistant.completed" || event.event_type === "assistant.error";
            }
            if (terminal) return;
          } catch {
            logger.warn("assistant run SSE tick failed");
          }
          if (signal.aborted) return;
          await sleep(assistantRunSsePollMs());
          if (signal.aborted) return;
          const fresh = await repository.freshRun(runId);
          if (fresh === null) return;
          row = await repository.resolveStale(fresh);
        }
      })(),
    };
  }

  async confirmGeneration(userId: UserId, threadId: string, rawRunId: unknown) {
    const thread = await this.requireThread(userId, threadId);
    if (typeof rawRunId !== "string" || !isUuid(rawRunId)) fail(422);
    const pending = await this.repository.beginGenerationConfirm(thread.id, rawRunId);
    try {
      const result = pending.result;
      if (result.kind === "missing") {
        await pending.release(false);
        throw new NotFoundException();
      }
      if (result.kind === "already") {
        const body = await this.generations.detail(userId, result.generationId);
        await pending.release(true);
        return { status: 200, body };
      }
      if (result.kind === "not_ready") {
        await pending.release(false);
        fail(409);
      }
      if (result.kind === "not_offer") {
        await pending.release(false);
        fail(409);
      }
      if (!(typeof result.offer.branch === "string" && (GENERATION_BRANCHES as readonly string[]).includes(result.offer.branch)) || typeof result.offer.prompt !== "string") {
        await pending.release(false);
        fail(500);
      }
      const created = await this.generations.create(userId, {
        branch: result.offer.branch,
        prompt: result.offer.prompt,
        params: result.offer.params,
        assistant_offer_id: rawRunId,
      });
      if (created.status !== 201) {
        await pending.release(false);
        return created;
      }
      const generation = created.body.generation;
      await result.finish(generation.id);
      await pending.release(true);
      return created;
    } catch (error) {
      await pending.release(false).catch(() => undefined);
      throw error;
    }
  }

  async promptVariants(userId: UserId, body: Readonly<Record<string, unknown>>, request: Request): Promise<AssistantPromptVariantsResponse> {
    await this.external.assertPromptVariantsRateLimit(request, userId);
    const query = body.query;
    if (typeof query !== "string" || query.trim().length === 0) fail(422);
    const normalizedQuery = query.trim();
    if (normalizedQuery.length > PROMPT_VARIANTS_QUERY_MAX_LENGTH) fail(413);
    if (this.external.isPromptBlocked(normalizedQuery)) fail(422);
    if (body.context !== undefined && !(PROMPT_VARIANTS_CONTEXTS as readonly unknown[]).includes(body.context)) fail(422);
    const batch = body.batch ?? 0;
    if (typeof batch !== "number" || !Number.isInteger(batch) || batch < 0 || batch > PROMPT_VARIANTS_MAX_BATCH) fail(422);
    const rawExcluded = body.exclude_labels ?? [];
    if (
      !Array.isArray(rawExcluded) ||
      rawExcluded.length > PROMPT_VARIANTS_EXCLUDE_MAX_ITEMS ||
      !rawExcluded.every((label) => typeof label === "string" && label.trim().length > 0 && label.trim().length <= PROMPT_VARIANTS_EXCLUDE_LABEL_MAX_LENGTH)
    )
      fail(422);
    const excludeLabels = rawExcluded.map((label) => String(label).trim());
    let limit = PROMPT_VARIANTS_DEFAULT_LIMIT;
    if (body.limit !== undefined) {
      if (typeof body.limit !== "number" || !Number.isInteger(body.limit) || body.limit < PROMPT_VARIANTS_MIN_LIMIT || body.limit > PROMPT_VARIANTS_MAX_LIMIT) fail(422);
      limit = body.limit;
    }
    const requestId = randomUUID();
    const [catalogMatches, giga] = await Promise.all([
      this.external.searchCatalogMatches(normalizedQuery).catch(() => []),
      this.external.requestPromptVariants(normalizedQuery, limit, batch, excludeLabels),
    ]);
    if (!giga.ok)
      return {
        contract_version: PROMPT_VARIANTS_CONTRACT_VERSION,
        request_id: requestId,
        intent: { normalized_query: normalizedQuery, motif: null },
        variants: heuristicVariants(normalizedQuery, requestId, limit, batch, excludeLabels),
        catalog_matches: catalogMatches,
        degraded: true,
      };
    const candidates = giga.draft.variants.slice(0, limit);
    const relevant = candidates.filter((variant) => keepsQuerySubject(normalizedQuery, variant.label, variant.prompt));
    const degraded = relevant.length !== candidates.length;
    const variants: Array<AssistantPromptVariant & { readonly id: string }> = relevant.map((variant, index) => ({
      id: `${requestId}-${index}`,
      label: variant.label,
      prompt: strengthenFunctionalPrompt(normalizedQuery, variant.prompt),
      motif: variant.motif,
      confidence: variant.confidence,
    }));
    if (degraded && variants.length < limit)
      variants.push(...heuristicVariants(normalizedQuery, requestId, limit - variants.length, batch, [...excludeLabels, ...candidates.map((variant) => variant.label)]));
    return {
      contract_version: PROMPT_VARIANTS_CONTRACT_VERSION,
      request_id: requestId,
      intent: { normalized_query: keepsQuerySubject(normalizedQuery, giga.draft.normalized_query, "") ? giga.draft.normalized_query : normalizedQuery, motif: giga.draft.motif },
      variants,
      catalog_matches: catalogMatches,
      ...(degraded ? { degraded: true as const } : {}),
    };
  }

  private async requireThread(userId: UserId, threadId: string) {
    if (!isUuid(threadId)) throw new NotFoundException();
    const thread = await this.repository.ownedThread(threadId, userId);
    if (thread === null) throw new NotFoundException();
    return thread;
  }
}
