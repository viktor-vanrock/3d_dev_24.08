import { useCallback, useEffect, useRef, useState } from "react";
import { useGuestLogin, type SessionUser } from "@domains/access";
import {
  createConceptGeneration,
  createGeneration,
  getGeneration,
  type Generation,
  type GenerationStatus,
} from "@domains/ai";
import {
  buildPromptConcepts,
  displayConceptDescription,
  listCachedConcepts,
  requestPromptConcepts,
  type CachedConcept,
  type ConceptCacheState,
  type PromptConcept,
  type PromptConceptState,
} from "./promptconcepts.ts";
import { generatePath, navigate } from "../../router.ts";

const TERMINAL = new Set<GenerationStatus>(["done", "error", "timed_out"]);
const POLL_MS = 1_800;
const CONCEPT_BATCH_SIZE = 6;
// Бесконечная лента не должна ждать полный 12-секундный сетевой timeout Gemma.
// Если fast-слот не успел интерактивно, локальный комбинатор сразу выдаёт шесть
// разных идей; сам запрос продолжает завершаться без блокировки UI.
const PROMPT_SCROLL_FALLBACK_MS = 700;
// Три Z-Image ракурса (~30с каждый) + TRELLIS ComfyUI (~150с). Это стартовая
// оценка до первого server progress. Как только worker публикует eta_seconds вместе
// с estimate_updated_at, плитка ведёт живой отсчёт именно от серверного снимка.
const TRELLIS_INITIAL_ETA_SECONDS = 240;

export interface FlowConcept extends PromptConcept {
  conceptId: string | null;
  generationId: string | null;
  previewUrl: string | null;
  state: "queued" | "generating" | "ready" | "failed";
  arrival: "cached" | "prompt" | "image";
  trellisStatus: GenerationStatus | "starting" | null;
  trellisProgress: number | null;
  trellisEtaSeconds: number | null;
  trellisEstimateAt: number | null;
}

export interface ConceptFlow {
  concepts: FlowConcept[];
  initialLoading: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  loadMore: () => void;
  setVisible: (
    conceptId: string,
    visible: boolean,
    position?: { left: number; top: number },
  ) => void;
  select: (concept: FlowConcept) => void;
}

interface PendingGeneration {
  variant: PromptConcept;
  run: number;
  query: string;
}

interface VisibleConceptPosition {
  left: number;
  top: number;
}

function comparable(value: string): string {
  return value.toLocaleLowerCase("ru").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

function conceptKeys(concept: Pick<PromptConcept, "label" | "prompt">): string[] {
  return [
    comparable(concept.label),
    comparable(displayConceptDescription(concept.prompt)),
  ];
}

function distinctCachedConcepts(concepts: CachedConcept[]): CachedConcept[] {
  const seen = new Set<string>();
  return concepts.filter((concept) => {
    const keys = conceptKeys(concept);
    if (keys.some((key) => seen.has(key))) return false;
    keys.forEach((key) => seen.add(key));
    return true;
  });
}

function cachedCard(concept: CachedConcept): FlowConcept {
  return {
    id: `cache-${concept.id}`,
    conceptId: concept.id,
    generationId: concept.generationId,
    label: concept.label,
    prompt: concept.prompt,
    motif: concept.motif,
    previewUrl: concept.previewUrl,
    state: "ready",
    arrival: "cached",
    trellisStatus: null,
    trellisProgress: null,
    trellisEtaSeconds: null,
    trellisEstimateAt: null,
  };
}

function pendingCard(concept: PromptConcept): FlowConcept {
  return {
    ...concept,
    id: `variant-${concept.id}`,
    conceptId: null,
    generationId: null,
    previewUrl: null,
    state: "queued",
    arrival: "prompt",
    trellisStatus: null,
    trellisProgress: null,
    trellisEtaSeconds: null,
    trellisEstimateAt: null,
  };
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function normalizedProgress(job: Generation): number | null {
  if (job.progress == null) return null;
  return Math.max(0, Math.min(100, job.progress <= 1 ? job.progress * 100 : job.progress));
}

function generationEstimateAt(job: Generation): number {
  if (job.estimate_updated_at) {
    const timestamp = Date.parse(job.estimate_updated_at);
    if (Number.isFinite(timestamp)) return timestamp;
  }
  return Date.now();
}

export function useConceptFlow(
  user: SessionUser | null,
  query: string,
  promptState: PromptConceptState,
  cacheState: ConceptCacheState,
): ConceptFlow {
  const promptGuestLogin = useGuestLogin();
  const [concepts, setConcepts] = useState<FlowConcept[]>([]);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const discoveryRunRef = useRef(0);
  const startedKeyRef = useRef("");
  const trellisRunRef = useRef(new Map<string, number>());
  const loadingMoreRef = useRef(false);
  const cacheCursorRef = useRef<string | null>(null);
  const batchRef = useRef(1);
  const seenRef = useRef(new Set<string>());
  const shownLabelsRef = useRef<string[]>([]);
  const pendingGenerationsRef = useRef(new Map<string, PendingGeneration>());
  const visibleConceptsRef = useRef(new Map<string, VisibleConceptPosition>());
  const generationWorkerRunningRef = useRef(false);
  const drainGenerationQueueRef = useRef<() => void>(() => {});
  const queueDrainFrameRef = useRef<number | null>(null);

  const updateCard = useCallback((id: string, patch: Partial<FlowConcept>) => {
    setConcepts((current) => current.map((concept) => (concept.id === id ? { ...concept, ...patch } : concept)));
  }, []);

  const remember = useCallback((concept: Pick<PromptConcept, "label" | "prompt">): boolean => {
    const keys = conceptKeys(concept);
    if (keys.some((key) => seenRef.current.has(key))) return false;
    keys.forEach((key) => seenRef.current.add(key));
    shownLabelsRef.current.push(concept.label);
    return true;
  }, []);

  const runGeneration = useCallback(
    async ({ variant, run, query: trimmedQuery }: PendingGeneration) => {
      const cardId = `variant-${variant.id}`;
      if (run !== discoveryRunRef.current) return;
      updateCard(cardId, { state: "generating" });
      const created = await createConceptGeneration({
        query: trimmedQuery,
        label: variant.label,
        prompt: variant.prompt,
        motif: variant.motif,
      });
      const isCurrent = () => run === discoveryRunRef.current;
      if ("error" in created) {
        if (isCurrent()) updateCard(cardId, { state: "failed" });
        return;
      }

      const conceptId = created.concept.id;
      const previewUrl = created.concept.preview_url ?? `/concepts/${conceptId}/preview`;
      if (created.concept.status === "ready") {
        if (isCurrent()) {
          updateCard(cardId, {
            conceptId,
            generationId: created.concept.generation_id,
            previewUrl,
            state: "ready",
            arrival: "image",
          });
        }
        return;
      }

      let job = created.generation;
      if (job) {
        // После фактического POST задача уже попала на GPU. Даже если пользователь сменил
        // запрос или проскроллил карточку, ждём terminal перед следующим POST: на сервере
        // никогда не образуется скрытая очередь из задач этого клиента.
        while (!TERMINAL.has(job.status)) {
          await wait(POLL_MS);
          job = (await getGeneration(job.id)) ?? job;
        }
        if (!isCurrent()) return;
        if (job.status !== "done") {
          updateCard(cardId, { conceptId, generationId: job.id, state: "failed" });
          return;
        }
        updateCard(cardId, {
          conceptId,
          generationId: job.id,
          previewUrl,
          state: "ready",
          arrival: "image",
        });
        return;
      }

      // Exact-cache hit может принадлежать другому пользователю, поэтому owner-only
      // /generations/:id недоступен. Поллим публичный ready-cache, не приватную generation.
      // Этот чужой активный job тоже удерживает локальный семафор до ready.
      let ready: CachedConcept | null = null;
      for (let attempt = 0; attempt < 140 && !ready; attempt += 1) {
        await wait(POLL_MS);
        const refreshed = await listCachedConcepts(trimmedQuery);
        ready = refreshed?.concepts.find((item) => item.id === conceptId) ?? null;
      }
      if (!isCurrent()) return;
      if (ready) {
        updateCard(cardId, {
          conceptId: ready.id,
          generationId: ready.generationId,
          previewUrl: ready.previewUrl,
          state: "ready",
          arrival: "image",
        });
      } else {
        updateCard(cardId, { conceptId, state: "failed" });
      }
    },
    [updateCard],
  );

  const drainGenerationQueue = useCallback(() => {
    if (generationWorkerRunningRef.current) return;
    const eligible: Array<[string, PendingGeneration, VisibleConceptPosition]> = [];
    for (const entry of pendingGenerationsRef.current) {
      const [cardId, task] = entry;
      if (task.run !== discoveryRunRef.current) {
        pendingGenerationsRef.current.delete(cardId);
        continue;
      }
      const position = visibleConceptsRef.current.get(cardId);
      if (position) eligible.push([cardId, task, position]);
    }
    eligible.sort((left, right) => {
      const rowDelta = left[2].top - right[2].top;
      return Math.abs(rowDelta) > 8
        ? rowDelta
        : left[2].left - right[2].left;
    });
    const next = eligible[0] ?? null;
    if (!next) return;

    const [cardId, task] = next;
    pendingGenerationsRef.current.delete(cardId);
    generationWorkerRunningRef.current = true;
    void runGeneration(task)
      .catch(() => {
        if (task.run === discoveryRunRef.current) {
          updateCard(cardId, { state: "failed" });
        }
      })
      .finally(() => {
        generationWorkerRunningRef.current = false;
        drainGenerationQueueRef.current();
      });
  }, [runGeneration, updateCard]);
  drainGenerationQueueRef.current = drainGenerationQueue;

  // IntersectionObserver не гарантирует порядок callback'ов разных плиток. Собираем
  // все события видимости текущего кадра и только затем сортируем позиции — иначе
  // второй столбец может на миллисекунду обогнать первый и занять единственный GPU-слот.
  const scheduleGenerationQueue = useCallback(() => {
    if (queueDrainFrameRef.current !== null) return;
    queueDrainFrameRef.current = window.requestAnimationFrame(() => {
      queueDrainFrameRef.current = null;
      drainGenerationQueueRef.current();
    });
  }, []);

  const registerGeneration = useCallback(
    (variant: PromptConcept, run: number, trimmedQuery: string) => {
      if (!user) return;
      const cardId = `variant-${variant.id}`;
      pendingGenerationsRef.current.set(cardId, {
        variant,
        run,
        query: trimmedQuery,
      });
      scheduleGenerationQueue();
    },
    [scheduleGenerationQueue, user],
  );

  const setVisible = useCallback(
    (
      conceptId: string,
      visible: boolean,
      position: VisibleConceptPosition = { left: Number.MAX_SAFE_INTEGER, top: Number.MAX_SAFE_INTEGER },
    ) => {
      if (visible) {
        visibleConceptsRef.current.set(conceptId, position);
        scheduleGenerationQueue();
      } else {
        visibleConceptsRef.current.delete(conceptId);
      }
    },
    [scheduleGenerationQueue],
  );

  useEffect(() => {
    if (queueDrainFrameRef.current !== null) {
      window.cancelAnimationFrame(queueDrainFrameRef.current);
      queueDrainFrameRef.current = null;
    }
    discoveryRunRef.current += 1;
    startedKeyRef.current = "";
    trellisRunRef.current.clear();
    loadingMoreRef.current = false;
    cacheCursorRef.current = null;
    batchRef.current = 1;
    seenRef.current.clear();
    shownLabelsRef.current = [];
    pendingGenerationsRef.current.clear();
    visibleConceptsRef.current.clear();
    setConcepts([]);
    setLoadingMore(false);
    setHasMore(false);
  }, [query]);

  // Ready-кэш не ждёт 10–15 секунд Gemma: это отдельный быстрый источник, поэтому его карточки
  // появляются сразу. Infinite sentinel включится ниже только после завершения обоих запросов,
  // чтобы следующий батч не обогнал начальный.
  useEffect(() => {
    const trimmed = query.trim();
    if ((trimmed.length > 0 && trimmed.length < 2) || cacheState.kind !== "ready") return;
    setConcepts((current) =>
      current.length > 0
        ? current
        : distinctCachedConcepts(cacheState.concepts).map(cachedCard),
    );
  }, [cacheState, query]);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length === 0) {
      if (!["ready", "error"].includes(cacheState.kind)) return;
      const cached = cacheState.kind === "ready" ? cacheState.concepts : [];
      const runKey = JSON.stringify(["global", cached.map((item) => item.id)]);
      if (startedKeyRef.current === runKey) return;
      startedKeyRef.current = runKey;
      discoveryRunRef.current += 1;
      seenRef.current.clear();
      shownLabelsRef.current = [];
      setConcepts(cached.filter(remember).map(cachedCard));
      cacheCursorRef.current = cacheState.kind === "ready" ? cacheState.nextCursor : null;
      setHasMore(cacheCursorRef.current !== null);
      return;
    }
    if (trimmed.length < 2) return;
    if (!["ready", "error"].includes(promptState.kind) || !["ready", "error"].includes(cacheState.kind)) return;

    const cached = cacheState.kind === "ready" ? cacheState.concepts : [];
    const variants = promptState.kind === "ready" ? promptState.concepts : [];
    const runKey = JSON.stringify([
      trimmed,
      user?.id ?? null,
      cached.map((item) => item.id),
      variants.map((item) => item.id),
    ]);
    if (startedKeyRef.current === runKey) return;
    startedKeyRef.current = runKey;
    const run = ++discoveryRunRef.current;

    seenRef.current.clear();
    shownLabelsRef.current = [];
    const cachedCards = cached.filter(remember).map(cachedCard);
    // Ready RAG-карточки закрывают первые слоты. Только действительно недостающие варианты
    // становятся skeleton'ами и попадают в единственную последовательную Z-Image цепочку.
    const missingCount = Math.max(0, variants.length - cachedCards.length);
    const missing: PromptConcept[] = [];
    if (user) {
      for (const variant of variants) {
        if (missing.length >= missingCount) break;
        if (remember(variant)) missing.push(variant);
      }
    }
    setConcepts([...cachedCards, ...missing.map(pendingCard)]);
    cacheCursorRef.current = cacheState.kind === "ready" ? cacheState.nextCursor : null;
    batchRef.current = 1;
    setHasMore(Boolean(user) || cacheCursorRef.current !== null);
    missing.forEach((variant) => registerGeneration(variant, run, trimmed));
  }, [cacheState, promptState, query, registerGeneration, remember, user]);

  const loadMore = useCallback(() => {
    const trimmed = query.trim();
    if (
      (trimmed.length > 0 && trimmed.length < 2) ||
      loadingMoreRef.current ||
      (trimmed.length > 0 && !user && cacheCursorRef.current === null) ||
      (trimmed.length === 0 && cacheCursorRef.current === null)
    ) {
      return;
    }
    loadingMoreRef.current = true;
    setLoadingMore(true);
    const run = discoveryRunRef.current;

    void (async () => {
      const cachedAdditions: FlowConcept[] = [];
      let remaining = CONCEPT_BATCH_SIZE;

      let cachePageAttempts = 0;
      while (cacheCursorRef.current !== null && remaining > 0 && cachePageAttempts < 4) {
        cachePageAttempts += 1;
        const cachedPage = await listCachedConcepts(trimmed || undefined, CONCEPT_BATCH_SIZE, cacheCursorRef.current);
        if (run !== discoveryRunRef.current) return;
        cacheCursorRef.current = cachedPage?.nextCursor ?? null;
        for (const cached of cachedPage?.concepts ?? []) {
          if (remaining === 0) break;
          if (!remember(cached)) continue;
          cachedAdditions.push(cachedCard(cached));
          remaining -= 1;
        }
      }

      // RAG-кэш уже готов и не должен стоять за 10–55 сек ответа Gemma. Сразу
      // дорисовываем найденные карточки, затем отдельно запрашиваем недостающие идеи.
      if (cachedAdditions.length > 0) {
        setConcepts((current) => [...current, ...cachedAdditions]);
      }

      const generatedAdditions: FlowConcept[] = [];
      if (trimmed.length > 0 && user && remaining > 0) {
        const batch = batchRef.current++;
        const excludes = shownLabelsRef.current.slice(-48);
        const generated = await Promise.race([
          requestPromptConcepts(trimmed, { batch, excludeLabels: excludes }),
          wait(PROMPT_SCROLL_FALLBACK_MS).then(() => null),
        ]);
        if (run !== discoveryRunRef.current) return;
        // Локальный творческий fallback дополняет частичный/повторившийся ответ Gemma, поэтому
        // каждый scroll-батч всегда получает до шести новых содержательных направлений.
        const candidates = [...(generated ?? []), ...buildPromptConcepts(trimmed, batch)];
        const fresh: PromptConcept[] = [];
        for (const candidate of candidates) {
          if (fresh.length >= remaining) break;
          if (!remember(candidate)) continue;
          fresh.push(candidate);
          generatedAdditions.push(pendingCard(candidate));
        }
        fresh.forEach((variant) => registerGeneration(variant, run, trimmed));
      }

      if (run !== discoveryRunRef.current) return;
      if (generatedAdditions.length > 0) {
        setConcepts((current) => [...current, ...generatedAdditions]);
      }
      setHasMore((trimmed.length > 0 && Boolean(user)) || cacheCursorRef.current !== null);
      loadingMoreRef.current = false;
      setLoadingMore(false);
    })().catch(() => {
      if (run !== discoveryRunRef.current) return;
      loadingMoreRef.current = false;
      setLoadingMore(false);
      setHasMore((trimmed.length > 0 && Boolean(user)) || cacheCursorRef.current !== null);
    });
  }, [query, registerGeneration, remember, user]);

  const select = useCallback(
    async (concept: FlowConcept) => {
      if (
        concept.state !== "ready" ||
        concept.trellisStatus === "starting" ||
        concept.trellisStatus === "queued" ||
        concept.trellisStatus === "running" ||
        concept.trellisStatus === "done"
      ) {
        return;
      }
      if (!user) {
        promptGuestLogin();
        return;
      }
      const run = (trellisRunRef.current.get(concept.id) ?? 0) + 1;
      trellisRunRef.current.set(concept.id, run);
      updateCard(concept.id, {
        trellisStatus: "starting",
        trellisProgress: null,
        trellisEtaSeconds: TRELLIS_INITIAL_ETA_SECONDS,
        trellisEstimateAt: Date.now(),
      });
      const created = await createGeneration({
        branch: "trellis",
        prompt: concept.prompt,
        params: {
          concept_id: concept.conceptId,
          source: "homepage_concept_cache",
        },
      });
      if (trellisRunRef.current.get(concept.id) !== run) return;
      if ("error" in created) {
        updateCard(concept.id, { trellisStatus: "error" });
        return;
      }
      let job = created.generation;
      updateCard(concept.id, {
        generationId: job.id,
        trellisStatus: job.status,
        trellisProgress: normalizedProgress(job),
        ...(job.eta_seconds == null
          ? {}
          : {
              trellisEtaSeconds: job.eta_seconds,
              trellisEstimateAt: generationEstimateAt(job),
            }),
      });
      while (!TERMINAL.has(job.status)) {
        await wait(POLL_MS);
        if (trellisRunRef.current.get(concept.id) !== run) return;
        job = (await getGeneration(job.id)) ?? job;
        updateCard(concept.id, {
          trellisStatus: job.status,
          trellisProgress: normalizedProgress(job),
          ...(job.eta_seconds == null
            ? {}
            : {
                trellisEtaSeconds: job.eta_seconds,
                trellisEstimateAt: generationEstimateAt(job),
              }),
        });
      }
      if (job.status === "done" && trellisRunRef.current.get(concept.id) === run) {
        navigate(generatePath(job.id));
      }
    },
    [promptGuestLogin, updateCard, user],
  );

  return {
    concepts,
    initialLoading: !["ready", "error"].includes(cacheState.kind),
    loadingMore,
    hasMore,
    loadMore,
    setVisible,
    select: (concept) => void select(concept),
  };
}
