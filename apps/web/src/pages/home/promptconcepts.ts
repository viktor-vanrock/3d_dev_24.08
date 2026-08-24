import type { components } from "../../api/generated/openapi";
import { API_URL } from "@shared/api";
const PROMPT_VARIANT_TIMEOUT_MS = 12_000;
const CONCEPT_CACHE_TIMEOUT_MS = 8_000;
const FUNCTIONAL_QUERY_RE =
  /(держател|подставк|органайзер|креплен|кронштейн|крюч|стойк|док-станц)/iu;
export const FUNCTIONAL_PROMPT_GUARD_MARKER = "Пустая опорная конструкция — главный объект";

export type PromptConceptMotif = "figure" | "articulated" | "functional" | "decor";

export interface PromptConcept {
  id: string;
  label: string;
  prompt: string;
  motif: PromptConceptMotif;
}

export interface CachedConcept extends PromptConcept {
  generationId: string;
  previewUrl: string;
  reuseCount: number;
  score: number | null;
}

export type PromptConceptState =
  | { kind: "idle"; concepts: [] }
  | { kind: "loading"; concepts: [] }
  | { kind: "ready"; concepts: PromptConcept[] }
  | { kind: "error"; concepts: [] };

export type ConceptCacheState =
  | { kind: "idle"; concepts: [] }
  | { kind: "loading"; concepts: [] }
  | { kind: "ready"; concepts: CachedConcept[]; degraded: boolean; nextCursor: string | null }
  | { kind: "error"; concepts: [] };


export function normalizeMotif(raw: unknown, label = ""): PromptConceptMotif {
  const value = `${typeof raw === "string" ? raw : ""} ${label}`.toLocaleLowerCase("ru");
  if (/(шарнир|articulat|flex|подвиж)/u.test(value)) return "articulated";
  if (/(держател|креп|органайз|подстав|hook|holder|functional)/u.test(value)) return "functional";
  if (/(кашпо|ваза|декор|светиль|decor|planter)/u.test(value)) return "decor";
  return "figure";
}

function validText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function isFunctionalObjectQuery(rawQuery: string): boolean {
  return FUNCTIONAL_QUERY_RE.test(rawQuery.trim());
}

// Диффузионная модель сильнее цепляется за зависимое существительное («наушники»), чем за
// функцию («держатель»). Явно фиксируем функциональную конструкцию главным объектом кадра.
// Маркер также версионирует такие prompts: старые ошибочные cache_key больше не переиспользуются.
export function strengthenPromptForQuery(rawQuery: string, rawPrompt: string): string {
  const query = rawQuery.trim().replace(/\s+/gu, " ");
  const prompt = rawPrompt.trim();
  if (!isFunctionalObjectQuery(query) || prompt.includes(FUNCTIONAL_PROMPT_GUARD_MARKER)) {
    return prompt;
  }
  return `${sentenceCase(query)}. ${FUNCTIONAL_PROMPT_GUARD_MARKER}: ${query}. Показать конструкцию целиком и без предмета, который она держит, хранит или поддерживает. ${prompt}`;
}

export function displayConceptLabel(rawLabel: string): string {
  return rawLabel
    .replace(/\s*(?:·|—|-)?\s*серия\s+\d+\s*$/iu, "")
    .replace(/\s+/gu, " ")
    .trim();
}

export function displayConceptDescription(rawPrompt: string): string {
  const cleaned = rawPrompt
    .trim()
    .replace(/^3D-концепт\s+по\s+запросу\s+«[^»]+»\s*:\s*/iu, "")
    .replace(/;\s*творческое направление\s+\d+\.\d+\s*,?\s*/giu, "; ")
    .replace(/[;,]\s*единый цельный объект,\s*пригодный для 3D-печати\.?$/iu, "")
    .replace(/\s*Цельная форма,\s*пригодная для 3D-печати\.?$/iu, "")
    .replace(/\s+/gu, " ")
    .replace(/\s+([,.;:])/gu, "$1")
    .trim();
  return cleaned.length === 0
    ? rawPrompt.trim()
    : `${cleaned[0]!.toLocaleUpperCase("ru")}${cleaned.slice(1)}`;
}

async function fetchWithin(
  input: RequestInfo | URL,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response | null> {
  const controller = new AbortController();
  let timeoutId = 0;
  try {
    return await Promise.race([
      fetch(input, { ...init, signal: controller.signal }),
      new Promise<never>((_, reject) => {
        timeoutId = window.setTimeout(() => {
          controller.abort();
          reject(new Error("discovery timeout"));
        }, timeoutMs);
      }),
    ]);
  } catch {
    return null;
  } finally {
    if (timeoutId) window.clearTimeout(timeoutId);
  }
}
export async function requestPromptConcepts(
  query: string,
  options: { batch?: number; excludeLabels?: readonly string[] } = {},
): Promise<PromptConcept[] | null> {
  const response = await fetchWithin(
    `${API_URL}/assistant/prompt-variants`,
    {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query,
        context: "home",
        limit: 6,
        batch: options.batch ?? 0,
        exclude_labels: (options.excludeLabels ?? [])
          .slice(-48)
          .map((label) => label.trim().slice(0, 80))
          .filter(Boolean),
      }),
    },
    PROMPT_VARIANT_TIMEOUT_MS,
  );
  if (!response?.ok) return null;
  const body = (await response.json().catch(() => null)) as components["schemas"]["AssistantPromptVariantsResponseDto"] | null;
  if (!body || !Array.isArray(body.variants)) return null;
  return body.variants.flatMap((variant, index) => {
    if (!validText(variant.label) || !validText(variant.prompt)) return [];
    return [{
      id: validText(variant.id) ? variant.id : `variant-${index}`,
      label: displayConceptLabel(variant.label),
      prompt: strengthenPromptForQuery(query, variant.prompt),
      motif: normalizeMotif(variant.motif, variant.label),
    }];
  });
}

export async function listCachedConcepts(query?: string, limit = 12, cursor?: string | null): Promise<{
  concepts: CachedConcept[];
  degraded: boolean;
  nextCursor: string | null;
} | null> {
  const params = new URLSearchParams({ limit: String(limit) });
  if (query?.trim()) params.set("q", query);
  if (cursor) params.set("cursor", cursor);
  const response = await fetchWithin(
    `${API_URL}/concepts?${params}`,
    { credentials: "include" },
    CONCEPT_CACHE_TIMEOUT_MS,
  );
  if (!response?.ok) return null;
  const body = (await response.json().catch(() => null)) as components["schemas"]["ConceptsResponseDto"] | null;
  if (!body || !Array.isArray(body.concepts)) return null;
  const concepts = body.concepts.flatMap((concept) => {
    if (
      concept.status !== "ready" ||
      !validText(concept.id) ||
      !validText(concept.generation_id) ||
      !validText(concept.label) ||
      !validText(concept.prompt) ||
      !validText(concept.preview_url)
    ) {
      return [];
    }
    // После усиления предметного якоря старые functional-карточки с визуально неверным
    // главным объектом намеренно не берём из RAG. Новые prompts содержат marker и снова
    // полноценно кэшируются/переиспользуются.
    if (
      query &&
      isFunctionalObjectQuery(query) &&
      !concept.prompt.includes(FUNCTIONAL_PROMPT_GUARD_MARKER)
    ) {
      return [];
    }
    return [{
      id: concept.id,
      generationId: concept.generation_id,
      label: displayConceptLabel(concept.label),
      prompt: concept.prompt.trim(),
      motif: normalizeMotif(concept.motif, concept.label),
      previewUrl: concept.preview_url,
      reuseCount: typeof concept.reuse_count === "number" ? concept.reuse_count : 0,
      score: typeof concept.score === "number" ? concept.score : null,
    }];
  });
  return {
    concepts,
    degraded: body.degraded === true,
    nextCursor: validText(body.next_cursor) ? body.next_cursor : null,
  };
}

const FALLBACK_VARIANTS: Array<{
  labelTail: string;
  direction: string;
  motif: PromptConceptMotif;
}> = [
  {
    labelTail: "из силуэтов котиков",
    direction: "узор из силуэтов котиков, лапок и переплетённых хвостов с ясным круговым ритмом",
    motif: "decor",
  },
  {
    labelTail: "с меандром Древнего Рима",
    direction: "римский меандр, лавровые ветви и ритм античных архитектурных фризов",
    motif: "decor",
  },
  {
    labelTail: "японских волн",
    direction: "многоуровневый узор с волнами сэйгайха и асимметрией японской гравюры",
    motif: "decor",
  },
  {
    labelTail: "в ритме ар-деко",
    direction: "веерные лучи, ступенчатые арки и контрастная симметрия в духе ар-деко",
    motif: "decor",
  },
  {
    labelTail: "как ботанический атлас",
    direction: "рельефный гербарий из листьев папоротника, семенных коробочек и тонких стеблей",
    motif: "decor",
  },
  {
    labelTail: "с картой созвездий",
    direction: "сетка созвездий со звёздными узлами, тонкими связями и одной выразительной орбитой",
    motif: "decor",
  },
];

const LATER_FALLBACK_VARIANTS = [
  ["с солнечными знаками майя", "ступенчатый орнамент и солнечные знаки архитектуры майя", "decor"],
  ["с морским бестиарием", "ритм из медуз, морских коньков и коралловых ветвей", "figure"],
  ["как пиксельный сад", "геометрический узор из пиксельных цветов и листьев", "decor"],
  ["северных рун", "плетёный северный орнамент с руническим ритмом без текста", "decor"],
  ["механического роя", "узор из миниатюрных шестерён, сот и механических жуков", "functional"],
  ["облаков и журавлей", "воздушный восточный мотив из облаков и летящих журавлей", "decor"],
  ["коралловых рифов", "органический рельеф из коралловых колоний и морских вееров", "figure"],
  ["с оптической иллюзией", "геометрический рельеф с эффектом невозможных лестниц", "decor"],
  ["сказочного леса", "узор из грибов, желудей, папоротников и крошечных дверей", "figure"],
  ["как киберпанк-схема", "слоистые дорожки печатной платы и световые техно-узлы", "functional"],
  ["в стиле русского модерна", "текучий цветочный орнамент и вытянутые линии русского модерна", "decor"],
  ["с лунными фазами", "последовательность лунных фаз, кратеров и тонких орбит", "decor"],
] as const satisfies ReadonlyArray<readonly [string, string, PromptConceptMotif]>;

const FALLBACK_COMPOSITIONS = [
  ["", ""],
  ["в спиральном ритме", "композиция закручивается по спирали"],
  ["с крупным центральным медальоном", "в центре расположен крупный смысловой медальон"],
  ["в виде непрерывной ленты", "мотив складывается в непрерывную круговую ленту"],
  ["с чередованием крупных и мелких деталей", "крупные элементы ритмично чередуются с мелкими"],
  ["в диагональной композиции", "мотив развивается по выразительной диагонали"],
  ["с зеркальной симметрией", "композиция построена на ясной зеркальной симметрии"],
  ["в ритме мозаики", "элементы собраны в плотный мозаичный ритм"],
  ["с одним намеренным разрывом", "непрерывный орнамент имеет один выразительный разрыв"],
  ["как многослойный барельеф", "детали образуют многослойный барельеф разной глубины"],
  ["с узором, растущим снизу вверх", "плотность деталей постепенно растёт снизу вверх"],
  ["в свободной асимметрии", "композиция держится на уравновешенной свободной асимметрии"],
] as const;

const FALLBACK_TREATMENTS = [
  ["", ""],
  ["с тонкими рёбрами", "тонкие печатные рёбра подчёркивают силуэт и усиливают крупные плоскости"],
  ["с матовой микрофактурой", "спокойная микрофактура проявляется только в скользящем свете"],
  ["с глубоким барельефом", "крупный барельеф чередует глубокие впадины и мягко скруглённые выступы"],
  ["с гранёными плоскостями", "оболочка собрана из ясных гранёных плоскостей с плавными фасками"],
  ["с ажурными прорезями", "ажурные сквозные прорези образуют читаемый ритм без хрупких перемычек"],
  ["со слоистыми контурами", "ступенчатые контуры слоями повторяют основной силуэт объекта"],
  ["с крупными канавками", "широкие плавные канавки направляют взгляд вдоль формы"],
  ["с точечной перфорацией", "точечная перфорация меняет плотность от основания к вершине"],
  ["с плавными фасками", "все переходы собраны широкими плавными фасками без острых кромок"],
  ["с волнистой оболочкой", "мягкая волнистая оболочка создаёт чередование света и тени"],
  ["с ячеистым рельефом", "ячейки разной глубины складываются в цельный печатаемый рельеф"],
] as const;

const FALLBACK_CONTEXTS = [
  ["", ""],
  ["для маленькой городской мастерской", "масштаб и детали рассчитаны на компактную городскую мастерскую"],
  ["как находка из будущего музея", "объект выглядит экспонатом археологического музея будущего"],
  ["для сказочной оранжереи", "силуэт и декор связывают объект со сказочной оранжереей"],
  ["с характером научного прибора", "конструкция получает точность и ритм старого научного прибора"],
  ["как талисман путешественника", "в композиции читается характер небольшого дорожного талисмана"],
  ["для дома у холодного моря", "форма учитывает суровый прибрежный характер и морской воздух"],
  ["как предмет космической колонии", "детали выглядят уместно в жилом модуле космической колонии"],
  ["для мастерской ботаника", "функциональные детали связаны с инструментами и образцами ботаника"],
  ["как реквизит камерного театра", "силуэт остаётся практичным, но получает выразительность театрального реквизита"],
  ["для детской комнаты исследователя", "образ дружелюбен и наполнен небольшими деталями для рассматривания"],
  ["как семейная вещь с историей", "поверхность и пропорции создают ощущение вещи, передаваемой поколениями"],
] as const;

const NARRATIVE_ACTION_PATTERN =
  "дела(?:ет|ют)|лет(?:ит|ят)|прыг(?:ает|ают)|перепрыг(?:ивает|ивают)|беж(?:ит|ат)|сид(?:ит|ят)|сто(?:ит|ят)|танцу(?:ет|ют)|ед(?:ет|ут)|ката(?:ется|ются)|ныря(?:ет|ют)|пар(?:ит|ят)|игра(?:ет|ют)|нес(?:ёт|ут)|держ(?:ит|ат)";
const NARRATIVE_QUERY_RE = new RegExp(
  `(?<![\\p{L}\\p{N}])(?:${NARRATIVE_ACTION_PATTERN}|над|сквозь|вокруг)(?![\\p{L}\\p{N}])`,
  "iu",
);
const NARRATIVE_ACTION_SPLIT_RE = new RegExp(
  `(?<![\\p{L}\\p{N}])(?:${NARRATIVE_ACTION_PATTERN})(?![\\p{L}\\p{N}])`,
  "iu",
);
const NARRATIVE_FORMS: ReadonlyArray<{
  title: string;
  promptLead: string;
  motif: PromptConceptMotif;
}> = [
  {
    title: "Сценическая миниатюра",
    promptLead: "Поймать кульминацию действия в одной устойчивой сцене с выразительной дугой движения",
    motif: "figure",
  },
  {
    title: "Рельефный момент",
    promptLead: "Сжать сюжет в глубокий барельеф, где силуэты и траектория читаются одним взглядом",
    motif: "decor",
  },
  {
    title: "Кинетический тотем",
    promptLead: "Превратить движение в вертикальный тотем, а траекторию — в несущую спираль",
    motif: "figure",
  },
  {
    title: "Шарнирная фигурка",
    promptLead: "Выделить главного героя в подвижную фигурку с позой, готовой к ключевому трюку",
    motif: "articulated",
  },
  {
    title: "Силуэтная траектория",
    promptLead: "Показать не всю сцену, а узнаваемый силуэт и непрерывную ленту его движения",
    motif: "decor",
  },
  {
    title: "Настольная сцена",
    promptLead: "Пересобрать замысел как компактную настольную композицию с ясным передним планом",
    motif: "figure",
  },
  {
    title: "Механический автоматон",
    promptLead: "Истолковать действие как простой механический автоматон с видимыми осями движения",
    motif: "articulated",
  },
  {
    title: "Круглый медальон",
    promptLead: "Заключить самый выразительный момент в круглый медальон с несколькими уровнями рельефа",
    motif: "decor",
  },
  {
    title: "Балансирующая скульптура",
    promptLead: "Найти точку равновесия и сделать сам жест основой балансирующей скульптуры",
    motif: "figure",
  },
  {
    title: "Модульная игрушка",
    promptLead: "Разложить сюжет на несколько соединённых модулей, которые меняют позу без разборки",
    motif: "articulated",
  },
  {
    title: "Подставка-силуэт",
    promptLead: "Превратить контур движения в функциональную подставку, не теряя узнаваемых героев",
    motif: "functional",
  },
  {
    title: "Спиральный трофей",
    promptLead: "Собрать ключевые формы вокруг восходящей спирали как фантазийный трофей события",
    motif: "figure",
  },
];

function sentenceCase(value: string): string {
  return value.length === 0 ? value : `${value[0]!.toLocaleUpperCase("ru")}${value.slice(1)}`;
}

function narrativeSubject(query: string): string {
  const beforeAction = query.split(NARRATIVE_ACTION_SPLIT_RE, 1)[0]?.trim() || query;
  const compact = beforeAction.length > 42 ? `${beforeAction.slice(0, 39).trim()}…` : beforeAction;
  return sentenceCase(compact);
}

function buildNarrativePromptConcepts(query: string, batch: number): PromptConcept[] {
  const subject = narrativeSubject(query);
  return Array.from({ length: 6 }, (_, index) => {
    const serial = batch * 6 + index;
    const form = NARRATIVE_FORMS[serial % NARRATIVE_FORMS.length]!;
    const [compositionLabel, compositionPrompt] =
      FALLBACK_COMPOSITIONS[Math.floor(serial / NARRATIVE_FORMS.length) % FALLBACK_COMPOSITIONS.length]!;
    const treatmentCycle = Math.floor(
      serial / (NARRATIVE_FORMS.length * FALLBACK_COMPOSITIONS.length),
    );
    const [treatmentLabel, treatmentPrompt] =
      FALLBACK_TREATMENTS[treatmentCycle % FALLBACK_TREATMENTS.length]!;
    const [contextLabel, contextPrompt] =
      FALLBACK_CONTEXTS[
        Math.floor(treatmentCycle / FALLBACK_TREATMENTS.length) % FALLBACK_CONTEXTS.length
      ]!;
    const label = `${form.title} «${subject}»${compositionLabel ? ` ${compositionLabel}` : ""}${
      treatmentLabel ? ` ${treatmentLabel}` : ""
    }${contextLabel ? ` ${contextLabel}` : ""}`;
    return {
      id: `query-context-fallback-${batch}-${index}`,
      label: label.length > 80 ? `${label.slice(0, 77).trim()}…` : label,
      prompt: `${form.promptLead}. Смысловой источник: ${sentenceCase(query)}.${
        compositionPrompt ? ` ${sentenceCase(compositionPrompt)}.` : ""
      }${treatmentPrompt ? ` ${sentenceCase(treatmentPrompt)}.` : ""}${
        contextPrompt ? ` ${sentenceCase(contextPrompt)}.` : ""
      } Все части физически соединены и пригодны для печати как один объект.`,
      motif: form.motif,
    };
  });
}

// Страховка на сетевой сбой API. Серверный degraded-ответ использует те же шесть направлений,
// но браузер не должен снова схлопываться до одной карточки, если недоступен уже сам API.
export function buildPromptConcepts(rawQuery: string, batch = 0): PromptConcept[] {
  const query = rawQuery.trim().replace(/\s+/g, " ");
  if (query.length < 3 || !/[\p{L}\p{N}]/u.test(query)) return [];
  if (!isFunctionalObjectQuery(query) && NARRATIVE_QUERY_RE.test(query)) {
    return buildNarrativePromptConcepts(query, batch);
  }
  const shortQuery = query.length > 64 ? `${query.slice(0, 61)}...` : query;
  const variants =
    batch === 0
      ? FALLBACK_VARIANTS.map((variant) => ({
          ...variant,
          compositionLabel: "",
          compositionPrompt: "",
        }))
      : Array.from({ length: 6 }, (_, index) => {
          const serial = (batch - 1) * 6 + index;
          const directionCount = LATER_FALLBACK_VARIANTS.length;
          const compositionCount = FALLBACK_COMPOSITIONS.length;
          const [labelTail, direction, motif] =
            LATER_FALLBACK_VARIANTS[serial % directionCount]!;
          const [compositionLabel, compositionPrompt] =
            FALLBACK_COMPOSITIONS[
              Math.floor(serial / directionCount) % compositionCount
            ]!;
          const treatmentCycle = Math.floor(serial / (directionCount * compositionCount));
          const [treatmentLabel, treatmentPrompt] =
            FALLBACK_TREATMENTS[treatmentCycle % FALLBACK_TREATMENTS.length]!;
          const [contextLabel, contextPrompt] =
            FALLBACK_CONTEXTS[
              Math.floor(treatmentCycle / FALLBACK_TREATMENTS.length) % FALLBACK_CONTEXTS.length
            ]!;
          return {
            labelTail,
            direction,
            motif,
            compositionLabel,
            compositionPrompt,
            treatmentLabel,
            treatmentPrompt,
            contextLabel,
            contextPrompt,
          };
        });
  return variants.map((variant, index) => ({
    id: `query-fallback-${batch}-${index}`,
    label: sentenceCase(
      `${shortQuery} ${variant.labelTail}${variant.compositionLabel ? ` ${variant.compositionLabel}` : ""}${
        "treatmentLabel" in variant && variant.treatmentLabel ? ` ${variant.treatmentLabel}` : ""
      }${"contextLabel" in variant && variant.contextLabel ? ` ${variant.contextLabel}` : ""}`,
    ),
    prompt: strengthenPromptForQuery(
      query,
      `${sentenceCase(query)}: ${variant.direction}${
        variant.compositionPrompt ? `; ${variant.compositionPrompt}` : ""
      }${"treatmentPrompt" in variant && variant.treatmentPrompt ? `; ${variant.treatmentPrompt}` : ""}${
        "contextPrompt" in variant && variant.contextPrompt ? `; ${variant.contextPrompt}` : ""
      }. Цельная форма, пригодная для 3D-печати.`,
    ),
    motif: variant.motif,
  }));
}
