import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { MarketModel } from "@domains/commerce";
import { OverlayProvider } from "@platform/overlay";
import { ThemeProvider } from "@platform/theme";
import { HomeScreen } from "./home.tsx";

// Живой поиск и полки (home.visual.md §2-4) — HeroSearch/useHomeSearch/Showcase/useShelves не
// были покрыты тестами (QA-прогон MF-918, ffa9a696). Мокаем только сеть (fetch), рендерим
// целиком HomeScreen с returning-активацией, чтобы FirstRunFlow не мешал (не предмет теста).

const user = { id: "u1", username: "tester", display_name: null, avatar_url: null, handle_confirmed: true, role: "user" as const };

function model(id: string, title: string): MarketModel {
  return {
    id,
    title,
    description: null,
    status: "ready",
    source_format: "stl",
    craft: "3d_printing",
    manufacturing_method: null,
    requires_ams: false,
    created_at: "2026-01-01T00:00:00Z",
    votes_up: 0,
    votes_down: 0,
    downloads_count: 0,
    tags: [],
    thumb_url: `/models/${id}/thumbnail`,
    owner: { id: "o1", username: "author" },
    project_summary: { file_count: 1, build_steps_count: 0 },
  };
}

const POPULAR_MODELS = Array.from({ length: 5 }, (_, i) => model(`pop-${i}`, `Популярная модель ${i}`));

interface MockOptions {
  searchHandler?: (q: string) => { models: MarketModel[]; hasMore?: boolean } | "error";
  activationEvents?: unknown[];
  hasPrinter?: boolean;
  conceptRequests?: Array<{ query: string; label: string; prompt: string; motif: string }>;
  promptVariantRequests?: Array<{ query: string; batch: number; exclude_labels: string[] }>;
  promptVariantsUnavailable?: boolean;
  promptVariantsGate?: Promise<void>;
  promptVariantsGateFromBatch?: number;
  conceptResponseGate?: Promise<void>;
  trellisSequence?: Array<Record<string, unknown>>;
  cachedConcepts?: Array<{
    id: string;
    generation_id: string;
    label: string;
    prompt: string;
    motif: string;
    preview_url: string;
    reuse_count: number;
    score: number;
    status: "ready";
  }>;
  cachedConceptPages?: Array<Array<{
    id: string;
    generation_id: string;
    label: string;
    prompt: string;
    motif: string;
    preview_url: string;
    reuse_count: number;
    score: number;
    status: "ready";
  }>>;
  globalCachedConcepts?: Array<{
    id: string;
    generation_id: string;
    label: string;
    prompt: string;
    motif: string;
    preview_url: string;
    reuse_count: number;
    score: number;
    status: "ready";
  }>;
  globalCachedConceptPages?: Array<Array<{
    id: string;
    generation_id: string;
    label: string;
    prompt: string;
    motif: string;
    preview_url: string;
    reuse_count: number;
    score: number;
    status: "ready";
  }>>;
  cachedConceptsByQuery?: Record<string, Array<{
    id: string;
    generation_id: string;
    label: string;
    prompt: string;
    motif: string;
    preview_url: string;
    reuse_count: number;
    score: number;
    status: "ready";
  }>>;
}

function promptVariants(query: string, batch = 0) {
  if (batch > 0) {
    return [
      "Орнамент из котиков",
      "Меандр Древнего Рима",
      "Японские волны",
      "Ар-деко",
      "Ботанический атлас",
      "Карта созвездий",
    ].map((direction, index) => ({
      id: `variant-${batch}-${index}`,
      label: `${query} · ${direction}`,
      prompt: `${query}, ${direction}, product shot, batch ${batch}`,
      motif: "decor",
      confidence: 0.7,
    }));
  }
  const labels = query === "кролик"
    ? ["кролик в шляпе", "красный кролик", "шарнирный кролик", "кролик-кашпо"]
    : [`${query} в минималистичном стиле`, `шарнирный ${query}`, `настольный ${query}`, `${query}-держатель`];
  return labels.map((label, index) => ({
    id: `variant-${index}`,
    label,
    prompt: `${label}, product shot`,
    motif: index === 1 ? "articulated" : "figure",
    confidence: 0.8,
  }));
}

function mockFetch({
  searchHandler,
  activationEvents,
  hasPrinter = true,
  conceptRequests,
  promptVariantRequests,
  promptVariantsUnavailable = false,
  promptVariantsGate,
  promptVariantsGateFromBatch = 0,
  conceptResponseGate,
  trellisSequence,
  cachedConcepts = [],
  cachedConceptPages,
  globalCachedConcepts = [],
  globalCachedConceptPages,
  cachedConceptsByQuery,
}: MockOptions = {}) {
  let conceptSequence = 0;
  let trellisRead = 1;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/me/activation/events")) {
        activationEvents?.push(JSON.parse(String(init?.body)));
        return new Response(null, { status: 202 });
      }
      if (url.includes("/me/activation")) {
        return new Response(
          JSON.stringify({
            activation: {
              state: "returning",
              has_printer: hasPrinter,
              primary_persona: null,
              home_tier: "auto",
              activation_checklist: {},
              home_dismissed_prompts: {},
            },
            printers: [],
            filaments: [],
          }),
          { status: 200 },
        );
      }
      if (url.includes("/models")) {
        const parsed = new URL(url, "http://localhost");
        const q = parsed.searchParams.get("q");
        if (q !== null) {
          if (!searchHandler) return new Response(null, { status: 500 });
          const result = searchHandler(q);
          if (result === "error") return new Response(null, { status: 500 });
          return new Response(JSON.stringify({ models: result.models, has_more: result.hasMore ?? false, next_cursor: null }), { status: 200 });
        }
        return new Response(JSON.stringify({ models: POPULAR_MODELS, has_more: false, next_cursor: null }), { status: 200 });
      }
      if (url.includes("/concepts?")) {
        const parsed = new URL(url, "http://localhost");
        const pageIndex = Number(parsed.searchParams.get("cursor") ?? "0");
        const requestedQuery = parsed.searchParams.get("q");
        const global = requestedQuery === null;
        const pages = global ? globalCachedConceptPages : cachedConceptPages;
        const concepts =
          (requestedQuery === null ? undefined : cachedConceptsByQuery?.[requestedQuery]) ??
          pages?.[pageIndex] ??
          (global ? globalCachedConcepts : cachedConcepts);
        const nextCursor =
          pages && pageIndex + 1 < pages.length
            ? String(pageIndex + 1)
            : null;
        return new Response(
          JSON.stringify({
            query: "",
            concepts,
            degraded: false,
            next_cursor: nextCursor,
          }),
          { status: 200 },
        );
      }
      if (url.endsWith("/assistant/prompt-variants") && init?.method === "POST") {
        if (promptVariantsUnavailable) {
          return new Response(JSON.stringify({ error: "unavailable" }), { status: 503 });
        }
        const body = JSON.parse(String(init.body)) as { query: string; batch?: number; exclude_labels?: string[] };
        promptVariantRequests?.push({
          query: body.query,
          batch: body.batch ?? 0,
          exclude_labels: body.exclude_labels ?? [],
        });
        if ((body.batch ?? 0) >= promptVariantsGateFromBatch) {
          await promptVariantsGate;
        }
        return new Response(JSON.stringify({
          contract_version: "assistant.prompt-variants.v1",
          variants: promptVariants(body.query, body.batch ?? 0),
        }), { status: 200 });
      }
      if (url.endsWith("/generations/concepts") && init?.method === "POST") {
        const body = JSON.parse(String(init.body)) as { query: string; label: string; prompt: string; motif: string };
        conceptRequests?.push(body);
        await conceptResponseGate;
        conceptSequence += 1;
        const id = `00000000-0000-4000-8000-${String(conceptSequence).padStart(12, "0")}`;
        return new Response(JSON.stringify({
          concept: {
            id,
            generation_id: id,
            normalized_query: body.query,
            label: body.label,
            prompt: body.prompt,
            motif: body.motif,
            reuse_count: 0,
            status: "ready",
            preview_url: `/concepts/${id}/preview`,
          },
          cached: false,
        }), { status: 201 });
      }
      if (url.endsWith("/generations") && init?.method === "POST" && trellisSequence?.[0]) {
        return new Response(JSON.stringify({ generation: trellisSequence[0] }), { status: 201 });
      }
      if (/\/generations\/[^/]+$/u.test(url) && (!init?.method || init.method === "GET") && trellisSequence?.length) {
        const generation = trellisSequence[Math.min(trellisRead, trellisSequence.length - 1)]!;
        trellisRead += 1;
        return new Response(JSON.stringify({ generation }), { status: 200 });
      }
      // «Создать своё» — assistant.v1 (packages/contracts/http/assistant.ts): thread + первое
      // сообщение перед уходом в мастерскую (workshop.tsx), см. useGenerate.send.
      if (url.endsWith("/assistant/threads") && init?.method === "POST") {
        const body = JSON.parse(String(init.body)) as { title?: string };
        return new Response(
          JSON.stringify({
            thread: { id: "thread-1", title: body.title ?? null, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z" },
          }),
          { status: 201 },
        );
      }
      if (url.includes("/assistant/threads/thread-1/messages") && init?.method === "POST") {
        return new Response(
          JSON.stringify({
            message: { id: "message-1", thread_id: "thread-1", role: "user", content: "дракон", run_id: null, created_at: "2026-01-01T00:00:00Z" },
            run: {
              id: "run-1",
              thread_id: "thread-1",
              triggering_message_id: "message-1",
              status: "queued",
              result_type: null,
              result: {},
              error_code: null,
              confirmed_generation_id: null,
              queue_position: 1,
              eta_seconds: null,
              created_at: "2026-01-01T00:00:00Z",
              updated_at: "2026-01-01T00:00:00Z",
            },
          }),
          { status: 201 },
        );
      }
      return new Response(null, { status: 404 });
    }),
  );
}

const infiniteObservers: ManualIntersectionObserver[] = [];

class ManualIntersectionObserver {
  #callback: IntersectionObserverCallback;
  #target: Element | null = null;

  constructor(callback: IntersectionObserverCallback) {
    this.#callback = callback;
    infiniteObservers.push(this);
  }

  observe(target: Element) {
    this.#target = target;
  }

  get target() {
    return this.#target;
  }

  trigger(
    isIntersecting = true,
    position: { left: number; top: number } = { left: 0, top: 0 },
  ) {
    if (!this.#target) return;
    this.#callback(
      [{
        isIntersecting,
        intersectionRatio: isIntersecting ? 1 : 0,
        boundingClientRect: {
          ...position,
          bottom: position.top + 300,
          height: 300,
          right: position.left + 200,
          width: 200,
          x: position.left,
          y: position.top,
          toJSON: () => ({}),
        },
        target: this.#target,
      } as IntersectionObserverEntry],
      this as unknown as IntersectionObserver,
    );
  }

  disconnect() {}
  unobserve() {}
  takeRecords() {
    return [];
  }
}

class VisibleIntersectionObserver {
  #callback: IntersectionObserverCallback;

  constructor(callback: IntersectionObserverCallback) {
    this.#callback = callback;
  }

  observe(target: Element) {
    queueMicrotask(() => {
      const visible = !target.matches(".homeConceptSentinel");
      this.#callback(
        [{
          isIntersecting: visible,
          intersectionRatio: visible ? 1 : 0,
          boundingClientRect: target.getBoundingClientRect(),
          target,
        } as IntersectionObserverEntry],
        this as unknown as IntersectionObserver,
      );
    });
  }

  disconnect() {}
  unobserve() {}
  takeRecords() {
    return [];
  }
}

beforeEach(() => {
  vi.stubGlobal("IntersectionObserver", VisibleIntersectionObserver);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  infiniteObservers.length = 0;
  window.localStorage.clear();
  window.history.replaceState(null, "", "/");
  Object.defineProperty(window, "scrollY", { configurable: true, value: 0 });
});

function renderHome() {
  return render(
    <ThemeProvider>
      <OverlayProvider>
        <HomeScreen user={user} section="home" onSectionChange={() => {}} />
      </OverlayProvider>
    </ThemeProvider>,
  );
}

describe("Подключение принтера с главной (MF-1726)", () => {
  it("показывает доступный FAB без принтера и ведёт в мастер подключения", async () => {
    const interactor = userEvent.setup();
    mockFetch({ hasPrinter: false });
    renderHome();

    const connect = await screen.findByRole("link", { name: "Подключить принтер" });
    expect(connect.getAttribute("href")).toBe("/park/add");

    connect.focus();
    expect(document.activeElement).toBe(connect);
    await interactor.click(connect);

    expect(window.location.pathname).toBe("/park/add");
  });

  it("не дублирует точку подключения, когда принтер уже есть", async () => {
    mockFetch({ hasPrinter: true });
    renderHome();

    await screen.findByText("Популярно сейчас · Печатают чаще всего");
    expect(screen.queryByRole("link", { name: "Подключить принтер" })).toBeNull();
  });
});

describe("Showcase — бесконечная общая лента (MF-2068)", () => {
  it("начинает популярную полку с опубликованного проекта SO-ARM100", async () => {
    mockFetch();
    renderHome();

    const robotArm = await screen.findByRole("button", { name: /^SO‑ARM100/ });
    expect(robotArm).toBeTruthy();
    expect(screen.getAllByRole("button").indexOf(robotArm)).toBeLessThan(
      screen.getAllByRole("button").indexOf(screen.getByRole("button", { name: /^Популярная модель 0/ })),
    );
  });

  it("не добавляет отдельные заголовки и секции внутри общей ленты", async () => {
    mockFetch();
    renderHome();

    expect(await screen.findByText("Популярно сейчас · Печатают чаще всего")).toBeTruthy();
    expect(screen.queryByText("Новое в каталоге")).toBeNull();
  });

  it("смешивает сохранённые генерации с реальными проектами уже без поискового запроса", async () => {
    const id = "50000000-0000-4000-8000-000000000001";
    mockFetch({
      globalCachedConcepts: [{
        id,
        generation_id: id,
        label: "Сохранённый шарнирный дракон",
        prompt: "Шарнирный дракон с видимыми суставами",
        motif: "articulated",
        preview_url: `/concepts/${id}/preview`,
        reuse_count: 3,
        score: 0.8,
        status: "ready",
      }],
    });
    renderHome();

    const robot = await screen.findByRole("button", { name: /^SO‑ARM100/ });
    const dragon = await screen.findByRole("button", { name: "Создать 3D: Сохранённый шарнирный дракон" });
    const buttons = screen.getAllByRole("button");
    expect(buttons.indexOf(robot)).toBeLessThan(buttons.indexOf(dragon));
  });

  it("тап по карточке популярной полки пишет id, позицию и коллекцию", async () => {
    const activationEvents: unknown[] = [];
    mockFetch({ activationEvents });
    renderHome();

    fireEvent.click(await screen.findByRole("button", { name: /^Популярная модель 1/ }));

    await waitFor(() =>
      expect(activationEvents).toContainEqual({
        event_name: "gallery_tile_click",
        props: { model_id: "pop-1", position: 3, collection: "popular" },
      }),
    );
  });

  it("физический scroll многократно догружает глобальный concept-кэш после сдвига sentinel", async () => {
    const cachePage = (start: number, count: number) =>
      Array.from({ length: count }, (_, index) => {
        const number = start + index;
        const id = `51000000-0000-4000-8000-${String(number).padStart(12, "0")}`;
        return {
          id,
          generation_id: id,
          label: `Глобальный концепт ${number}`,
          prompt: `Готовый глобальный концепт ${number}`,
          motif: "figure",
          preview_url: `/concepts/${id}/preview`,
          reuse_count: number,
          score: 0.8,
          status: "ready" as const,
        };
      });
    mockFetch({ globalCachedConceptPages: [cachePage(1, 6), cachePage(7, 2), cachePage(9, 2)] });
    vi.stubGlobal("IntersectionObserver", ManualIntersectionObserver);
    renderHome();

    await screen.findByRole("button", { name: "Создать 3D: Глобальный концепт 6" });
    await waitFor(() => expect(infiniteObservers.length).toBeGreaterThan(0));
    const sentinelObserver = infiniteObservers
      .find((observer) => observer.target?.matches(".homeConceptSentinel"))!;
    const sentinel = sentinelObserver.target as HTMLElement;
    let sentinelFar = true;
    vi.spyOn(sentinel, "getBoundingClientRect").mockImplementation(() => ({
      top: sentinelFar ? 2_000 : 400,
      bottom: sentinelFar ? 2_001 : 401,
      left: 0,
      right: 1,
      width: 1,
      height: 1,
      x: 0,
      y: sentinelFar ? 2_000 : 400,
      toJSON: () => ({}),
    }));
    sentinelObserver.trigger();
    expect(
      await screen.findByRole("button", { name: "Создать 3D: Глобальный концепт 8" }),
    ).toBeTruthy();

    sentinelFar = false;
    Object.defineProperty(window, "scrollY", { configurable: true, value: 100 });
    fireEvent.scroll(window);
    expect(
      await screen.findByRole("button", { name: "Создать 3D: Глобальный концепт 10" }),
    ).toBeTruthy();
  });
});

describe("HeroSearch/Showcase — живой поиск (home.visual.md §2/§4)", () => {
  it("пустое поле ясно обещает поиск или создание, но не показывает лишнюю искру", () => {
    mockFetch();
    renderHome();

    expect(screen.getByRole("textbox", { name: "Найти или создать модель" })).toHaveProperty("value", "");
    expect(screen.queryByText("Ищем готовое в проектах · если не найдётся — предложим создать")).toBeNull();
    expect(screen.queryByRole("button", { name: "Подсказать случайный запрос" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Создать модель:/ })).toBeNull();
  });

  it("не дублирует навигацию хедера ссылками на каталоги", () => {
    mockFetch();
    renderHome();

    expect(screen.queryByRole("navigation", { name: "Каталоги" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Филаменты" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Принтеры" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Проекты" })).toBeNull();
  });

  it("запрос короче 2 символов не бьёт в сеть — полки остаются", async () => {
    mockFetch();
    renderHome();
    await screen.findByText("Популярно сейчас · Печатают чаще всего");

    fireEvent.change(screen.getByPlaceholderText("Найти или создать модель"), { target: { value: "a" } });
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(screen.queryByText("Готовые проекты")).toBeNull();
    expect(screen.getByText("Популярно сейчас · Печатают чаще всего")).toBeTruthy();
  });

  it("от 2 символов, с дебаунсом — смешивает найденные проекты с вариантами создания", async () => {
    const interactor = userEvent.setup();
    mockFetch({ searchHandler: (q) => (q === "дракон" ? { models: [model("d1", "Шарнирный дракон")] } : { models: [] }) });
    renderHome();
    await screen.findByText("Популярно сейчас · Печатают чаще всего");

    await interactor.type(screen.getByRole("textbox", { name: "Найти или создать модель" }), "дракон");

    expect(await screen.findByText("Шарнирный дракон")).toBeTruthy();
    expect(await screen.findByRole("button", { name: "Создать 3D: дракон в минималистичном стиле" })).toBeTruthy();
    expect(screen.queryByText("Готовые проекты")).toBeNull();
    expect(screen.queryByText("Можно создать")).toBeNull();
    expect(window.location.search).toBe("?q=%D0%B4%D1%80%D0%B0%D0%BA%D0%BE%D0%BD");
  });

  it("не показывает в поисковой ленте записи без настоящего preview", async () => {
    const interactor = userEvent.setup();
    mockFetch({
      searchHandler: () => ({
        models: [
          { ...model("empty", "Пустой импорт"), thumb_url: null },
          model("ready", "Готовая модель"),
        ],
      }),
    });
    renderHome();

    await interactor.type(
      screen.getByRole("textbox", { name: "Найти или создать модель" }),
      "модель",
    );

    expect(await screen.findByText("Готовая модель")).toBeTruthy();
    expect(screen.queryByText("Пустой импорт")).toBeNull();
  });

  it("сразу убирает прошлую выдачу и показывает релевантный fallback до медленной Gemma", async () => {
    let releaseVariants!: () => void;
    const promptVariantsGate = new Promise<void>((resolve) => {
      releaseVariants = resolve;
    });
    const oldConcept = {
      id: "51000000-0000-4000-8000-000000000001",
      generation_id: "51000000-0000-4000-8000-000000000001",
      label: "Старая ваза из предыдущего запроса",
      prompt: "Ваза с прошлой страницы",
      motif: "decor",
      preview_url: "/concepts/51000000-0000-4000-8000-000000000001/preview",
      reuse_count: 1,
      score: 0.9,
      status: "ready" as const,
    };
    const wrongLegacyHolder = {
      ...oldConcept,
      id: "51000000-0000-4000-8000-000000000002",
      generation_id: "51000000-0000-4000-8000-000000000002",
      label: "Старые наушники без держателя",
      prompt: "Наушники с декоративными волнами",
    };
    mockFetch({
      searchHandler: () => ({ models: [] }),
      promptVariantsGate,
      cachedConceptsByQuery: {
        ваза: [oldConcept],
        "держатель наушников": [wrongLegacyHolder],
      },
    });
    renderHome();

    fireEvent.change(screen.getByRole("textbox", { name: "Найти или создать модель" }), {
      target: { value: "ваза" },
    });
    expect(await screen.findByText(oldConcept.label)).toBeTruthy();

    fireEvent.change(screen.getByRole("textbox", { name: "Найти или создать модель" }), {
      target: { value: "держатель наушников" },
    });
    expect(screen.queryByText(oldConcept.label)).toBeNull();
    expect(screen.queryByText(wrongLegacyHolder.label)).toBeNull();
    expect(
      await screen.findByText(
        "Держатель наушников из силуэтов котиков",
        {},
        { timeout: 2_000 },
      ),
    ).toBeTruthy();

    releaseVariants();
  });

  it("«не нашлось» — без пустой секции оставляет варианты генерации", async () => {
    const interactor = userEvent.setup();
    mockFetch({ searchHandler: () => ({ models: [] }) });
    renderHome();
    await screen.findByText("Популярно сейчас · Печатают чаще всего");

    await interactor.type(screen.getByRole("textbox", { name: "Найти или создать модель" }), "нгзвб");

    expect(await screen.findByRole("button", { name: "Создать 3D: нгзвб в минималистичном стиле" })).toBeTruthy();
    expect(screen.queryByText("Точного совпадения в каталоге нет.")).toBeNull();
  });

  it("поиск упал — варианты создания остаются, инлайн-ошибка + «Повторить»", async () => {
    mockFetch({ searchHandler: () => "error" });
    renderHome();
    await screen.findByText("Популярно сейчас · Печатают чаще всего");

    fireEvent.change(screen.getByPlaceholderText("Найти или создать модель"), { target: { value: "сломайся" } });

    expect(await screen.findByText("Поиск сейчас недоступен")).toBeTruthy();
    expect(screen.queryByText("Популярно сейчас · Печатают чаще всего")).toBeNull();
    expect(screen.getByText("Повторить")).toBeTruthy();
    expect(await screen.findByRole("button", { name: "Создать 3D: сломайся в минималистичном стиле" })).toBeTruthy();
  });

  it("для понятного запроса предлагает расширения без отдельного окна Giga", async () => {
    const interactor = userEvent.setup();
    mockFetch({ searchHandler: () => ({ models: [] }) });
    renderHome();

    await interactor.type(screen.getByRole("textbox", { name: "Найти или создать модель" }), "кролик");

    expect(await screen.findByRole("button", { name: "Создать 3D: кролик в шляпе" })).toBeTruthy();
    expect(screen.queryByText("Варианты идеи")).toBeNull();
    expect(window.location.pathname).toBe("/");
  });

  it("при недоступной Gemma сразу оставляет шесть разных карточек и запускает их по порядку", async () => {
    const interactor = userEvent.setup();
    const conceptRequests: Array<{ query: string; label: string; prompt: string; motif: string }> = [];
    mockFetch({
      searchHandler: () => ({ models: [] }),
      promptVariantsUnavailable: true,
      conceptRequests,
    });
    renderHome();

    await interactor.type(screen.getByRole("textbox", { name: "Найти или создать модель" }), "ваза с узором");
    await screen.findByRole("button", { name: "Создать 3D: Ваза с узором с картой созвездий" });

    expect(conceptRequests).toHaveLength(6);
    expect(conceptRequests.map((request) => request.label)).toEqual([
      "Ваза с узором из силуэтов котиков",
      "Ваза с узором с меандром Древнего Рима",
      "Ваза с узором японских волн",
      "Ваза с узором в ритме ар-деко",
      "Ваза с узором как ботанический атлас",
      "Ваза с узором с картой созвездий",
    ]);
    expect(new Set(conceptRequests.map((request) => request.prompt))).toHaveProperty("size", 6);
  });

  it("ставит Z-Image jobs слева направо, затем сверху вниз", async () => {
    const interactor = userEvent.setup();
    const conceptRequests: Array<{ query: string; label: string; prompt: string; motif: string }> = [];
    mockFetch({ searchHandler: () => ({ models: [] }), conceptRequests });
    vi.stubGlobal("IntersectionObserver", ManualIntersectionObserver);
    renderHome();

    await interactor.type(screen.getByRole("textbox", { name: "Найти или создать модель" }), "кролик");
    await screen.findByText("кролик-кашпо");
    await waitFor(() =>
      expect(
        infiniteObservers.filter((observer) => observer.target?.matches(".homeConceptTile--skeleton")),
      ).toHaveLength(4),
    );
    const cardObservers = infiniteObservers.filter((observer) =>
      observer.target?.matches(".homeConceptTile--skeleton"),
    );
    cardObservers[1]!.trigger(true, { left: 220, top: 0 });
    cardObservers[0]!.trigger(true, { left: 0, top: 0 });
    cardObservers[3]!.trigger(true, { left: 220, top: 320 });
    cardObservers[2]!.trigger(true, { left: 0, top: 320 });

    await waitFor(() => expect(conceptRequests).toHaveLength(4));
    expect(conceptRequests.map((request) => request.label)).toEqual([
      "кролик в шляпе",
      "красный кролик",
      "шарнирный кролик",
      "кролик-кашпо",
    ]);
  });

  it("не ставит невидимые карточки в GPU-очередь и продолжает с той, которую увидели", async () => {
    const interactor = userEvent.setup();
    const conceptRequests: Array<{ query: string; label: string; prompt: string; motif: string }> = [];
    let releaseFirst!: () => void;
    const firstResponseGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    mockFetch({
      searchHandler: () => ({ models: [] }),
      conceptRequests,
      conceptResponseGate: firstResponseGate,
    });
    vi.stubGlobal("IntersectionObserver", ManualIntersectionObserver);
    renderHome();

    await interactor.type(screen.getByRole("textbox", { name: "Найти или создать модель" }), "кролик");
    await screen.findByText("кролик-кашпо");
    await waitFor(() => {
      expect(infiniteObservers.filter((observer) => observer.target?.matches(".homeConceptTile--skeleton"))).toHaveLength(4);
    });
    const cardObservers = infiniteObservers.filter((observer) =>
      observer.target?.matches(".homeConceptTile--skeleton"),
    );

    expect(conceptRequests).toEqual([]);
    cardObservers.forEach((observer) => observer.trigger(true));
    await waitFor(() => expect(conceptRequests).toHaveLength(1));

    cardObservers.slice(1).forEach((observer) => observer.trigger(false));
    releaseFirst();
    await screen.findByRole("button", { name: "Создать 3D: кролик в шляпе" });
    await Promise.resolve();
    expect(conceptRequests).toHaveLength(1);

    cardObservers[2]!.trigger(true);
    await waitFor(() => expect(conceptRequests).toHaveLength(2));
    expect(conceptRequests.map((request) => request.label)).toEqual([
      "кролик в шляпе",
      "шарнирный кролик",
    ]);
  });

  it("переиспользует достаточный RAG-кэш без новых Z-Image jobs", async () => {
    const interactor = userEvent.setup();
    const conceptRequests: Array<{ query: string; label: string; prompt: string; motif: string }> = [];
    const cachedConcepts = Array.from({ length: 6 }, (_, index) => {
      const id = `10000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
      return {
        id,
        generation_id: id,
        label: `Кэшированная ваза ${index + 1}`,
        prompt: `Готовый промпт вазы ${index + 1}`,
        motif: "decor",
        preview_url: `/concepts/${id}/preview`,
        reuse_count: index,
        score: 0.9 - index * 0.01,
        status: "ready" as const,
      };
    });
    mockFetch({
      searchHandler: () => ({ models: [] }),
      conceptRequests,
      cachedConcepts,
    });
    renderHome();

    await interactor.type(screen.getByRole("textbox", { name: "Найти или создать модель" }), "ваза с узором");
    await screen.findByRole("button", { name: "Создать 3D: Кэшированная ваза 6" });

    expect(conceptRequests).toEqual([]);
  });

  it("дедуплицирует мгновенный кэш ещё до медленного ответа Gemma", async () => {
    const interactor = userEvent.setup();
    let releaseVariants!: () => void;
    const promptVariantsGate = new Promise<void>((resolve) => {
      releaseVariants = resolve;
    });
    const cachedConcepts = [
      {
        id: "40000000-0000-4000-8000-000000000001",
        generation_id: "40000000-0000-4000-8000-000000000001",
        label: "Ваза · Русский модерн · серия 3",
        prompt: "3D-концепт по запросу «ваза»: текучий цветочный орнамент; творческое направление 3.5, единый цельный объект, пригодный для 3D-печати",
        motif: "decor",
        preview_url: "/concepts/40000000-0000-4000-8000-000000000001/preview",
        reuse_count: 1,
        score: 0.9,
        status: "ready" as const,
      },
      {
        id: "40000000-0000-4000-8000-000000000002",
        generation_id: "40000000-0000-4000-8000-000000000002",
        label: "Ваза · Русский модерн · серия 7",
        prompt: "3D-концепт по запросу «ваза»: текучий цветочный орнамент; творческое направление 7.5, единый цельный объект, пригодный для 3D-печати",
        motif: "decor",
        preview_url: "/concepts/40000000-0000-4000-8000-000000000002/preview",
        reuse_count: 1,
        score: 0.88,
        status: "ready" as const,
      },
    ];
    mockFetch({
      searchHandler: () => ({ models: [] }),
      cachedConcepts,
      promptVariantsGate,
    });
    renderHome();

    await interactor.type(screen.getByRole("textbox", { name: "Найти или создать модель" }), "ваза");
    await screen.findByRole("button", { name: "Создать 3D: Ваза · Русский модерн" });
    expect(screen.getAllByRole("button", { name: "Создать 3D: Ваза · Русский модерн" })).toHaveLength(1);
    releaseVariants();
  });

  it("показывает ETA TRELLIS и открывает готовую 3D-модель на экране generation", async () => {
    const interactor = userEvent.setup();
    const cachedConcepts = Array.from({ length: 6 }, (_, index) => {
      const id = `30000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
      return {
        id,
        generation_id: id,
        label: `Кэшированная ваза ${index + 1}`,
        prompt: `Ваза с узором северных рун ${index + 1}`,
        motif: "decor",
        preview_url: `/concepts/${id}/preview`,
        reuse_count: index,
        score: 0.9 - index * 0.01,
        status: "ready" as const,
      };
    });
    const generationBase = {
      id: "trellis-ready",
      branch: "trellis",
      prompt: "Ваза с узором северных рун",
      params: {},
      preview_url: null,
      artifact_url: null,
      error: null,
      error_code: null,
      created_at: "2026-07-29T00:00:00Z",
      updated_at: "2026-07-29T00:00:00Z",
    };
    mockFetch({
      searchHandler: () => ({ models: [] }),
      cachedConcepts,
      trellisSequence: [
        { ...generationBase, status: "queued", progress: null },
        {
          ...generationBase,
          status: "running",
          progress: {
            phase: "geometry",
            progress: 42,
            eta_seconds: 125,
            estimate_updated_at: new Date().toISOString(),
          },
        },
        {
          ...generationBase,
          status: "done",
          preview_url: "/generations/trellis-ready/preview",
          artifact_url: "/generations/trellis-ready/artifact",
          progress: null,
        },
      ],
    });
    renderHome();

    await interactor.type(screen.getByRole("textbox", { name: "Найти или создать модель" }), "ваза с узором");
    const concept = await screen.findByRole("button", { name: "Создать 3D: Кэшированная ваза 1" });
    await interactor.click(concept);

    expect(await screen.findByText(/02:0[45]/u, {}, { timeout: 3_000 })).toBeTruthy();
    await waitFor(() => expect(window.location.pathname).toBe("/generate"), { timeout: 5_000 });
    expect(window.location.search).toBe("?gen=trellis-ready");
  }, 8_000);

  it("добавляет творческий батч у конца бесконечной ленты и сохраняет строгий порядок jobs", async () => {
    const interactor = userEvent.setup();
    const conceptRequests: Array<{ query: string; label: string; prompt: string; motif: string }> = [];
    const promptVariantRequests: Array<{ query: string; batch: number; exclude_labels: string[] }> = [];
    const cachedConcepts = Array.from({ length: 6 }, (_, index) => {
      const id = `20000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
      return {
        id,
        generation_id: id,
        label: `Кэшированная ваза ${index + 1}`,
        prompt: `Готовый промпт вазы ${index + 1}`,
        motif: "decor",
        preview_url: `/concepts/${id}/preview`,
        reuse_count: index,
        score: 0.9 - index * 0.01,
        status: "ready" as const,
      };
    });
    mockFetch({
      searchHandler: () => ({ models: [] }),
      conceptRequests,
      promptVariantRequests,
      cachedConcepts,
    });
    vi.stubGlobal("IntersectionObserver", ManualIntersectionObserver);
    renderHome();

    await interactor.type(screen.getByRole("textbox", { name: "Найти или создать модель" }), "ваза с узором");
    await screen.findByRole("button", { name: "Создать 3D: Кэшированная ваза 6" });
    await waitFor(() => expect(infiniteObservers.length).toBeGreaterThan(0));
    const sentinelObserver = infiniteObservers.find((observer) =>
      observer.target?.matches(".homeConceptSentinel"),
    )!;
    sentinelObserver.trigger();

    await screen.findByText("ваза с узором · Карта созвездий");
    await waitFor(() =>
      expect(
        infiniteObservers.filter((observer) => observer.target?.matches(".homeConceptTile--skeleton")),
      ).toHaveLength(6),
    );
    infiniteObservers
      .filter((observer) => observer.target?.matches(".homeConceptTile--skeleton"))
      .forEach((observer) => observer.trigger());
    await screen.findByRole("button", { name: "Создать 3D: ваза с узором · Карта созвездий" });
    await waitFor(() => expect(conceptRequests).toHaveLength(6));
    expect(promptVariantRequests.at(-1)).toEqual({
      query: "ваза с узором",
      batch: 1,
      exclude_labels: cachedConcepts.map((concept) => concept.label),
    });
    expect(conceptRequests.map((request) => request.label)).toEqual([
      "ваза с узором · Орнамент из котиков",
      "ваза с узором · Меандр Древнего Рима",
      "ваза с узором · Японские волны",
      "ваза с узором · Ар-деко",
      "ваза с узором · Ботанический атлас",
      "ваза с узором · Карта созвездий",
    ]);

    sentinelObserver.trigger();
    await Promise.resolve();
    expect(promptVariantRequests).toHaveLength(2);

    // Sentinel может всё ещё находиться внутри широкого rootMargin. Следующий
    // физический скролл должен открыть новый батч и без искусственного exit/re-enter.
    Object.defineProperty(window, "scrollY", { configurable: true, value: 500 });
    fireEvent.scroll(window);
    await waitFor(() => expect(promptVariantRequests).toHaveLength(3));
    expect(promptVariantRequests.at(-1)?.batch).toBe(2);
  });

  it("сразу анимирует пустые карточки и не теряет скролл, сделанный во время ответа Gemma", async () => {
    const interactor = userEvent.setup();
    let releaseVariants!: () => void;
    const promptVariantsGate = new Promise<void>((resolve) => {
      releaseVariants = resolve;
    });
    const promptVariantRequests: Array<{ query: string; batch: number; exclude_labels: string[] }> = [];
    const cachedConcepts = Array.from({ length: 6 }, (_, index) => {
      const id = `21000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
      return {
        id,
        generation_id: id,
        label: `Готовое кашпо ${index + 1}`,
        prompt: `Сохранённое кашпо ${index + 1}`,
        motif: "decor",
        preview_url: `/concepts/${id}/preview`,
        reuse_count: index,
        score: 0.9,
        status: "ready" as const,
      };
    });
    mockFetch({
      searchHandler: () => ({ models: [] }),
      cachedConcepts,
      promptVariantRequests,
      promptVariantsGate,
      promptVariantsGateFromBatch: 1,
    });
    vi.stubGlobal("IntersectionObserver", ManualIntersectionObserver);
    renderHome();

    await interactor.type(screen.getByRole("textbox", { name: "Найти или создать модель" }), "кашпо");
    await screen.findByRole("button", { name: "Создать 3D: Готовое кашпо 6" });
    const sentinelObserver = await waitFor(() => {
      const observer = infiniteObservers.find((item) =>
        item.target?.matches(".homeConceptSentinel"),
      );
      expect(observer).toBeTruthy();
      return observer!;
    });
    sentinelObserver.trigger();

    await waitFor(() => {
      expect(document.querySelectorAll(".homeConceptTile--tail-loading")).toHaveLength(6);
    });
    expect(
      Array.from(document.querySelectorAll<HTMLElement>(".homeConceptTile--tail-loading"))
        .map((tile) => tile.style.getPropertyValue("--i")),
    ).toEqual(["0", "1", "2", "3", "4", "5"]);
    expect(promptVariantRequests.at(-1)?.batch).toBe(1);

    Object.defineProperty(window, "scrollY", { configurable: true, value: 500 });
    fireEvent.scroll(window);
    releaseVariants();

    await waitFor(() => expect(promptVariantRequests.at(-1)?.batch).toBe(2));
    await waitFor(() => {
      expect(document.querySelectorAll(".homeConceptTile--tail-loading")).toHaveLength(0);
    });

    // Замена skeleton'ов может сдвинуть viewport назад. Следующий реальный скролл
    // вниз не должен сравниваться со старым абсолютным максимумом.
    Object.defineProperty(window, "scrollY", { configurable: true, value: 200 });
    fireEvent.scroll(window);
    Object.defineProperty(window, "scrollY", { configurable: true, value: 400 });
    fireEvent.scroll(window);
    await waitFor(() => expect(promptVariantRequests.at(-1)?.batch).toBe(3));
  });

  it("сразу добавляет следующую страницу кэша, пока Gemma готовит недостающие идеи", async () => {
    const interactor = userEvent.setup();
    let releaseVariants!: () => void;
    const promptVariantsGate = new Promise<void>((resolve) => {
      releaseVariants = resolve;
    });
    const cachePage = (start: number, count: number) =>
      Array.from({ length: count }, (_, index) => {
        const number = start + index;
        const id = `30000000-0000-4000-8000-${String(number).padStart(12, "0")}`;
        return {
          id,
          generation_id: id,
          label: `Кэшированная ваза ${number}`,
          prompt: `Готовый промпт кэшированной вазы ${number}`,
          motif: "decor",
          preview_url: `/concepts/${id}/preview`,
          reuse_count: number,
          score: 0.9 - number * 0.01,
          status: "ready" as const,
        };
      });
    const promptVariantRequests: Array<{ query: string; batch: number; exclude_labels: string[] }> = [];
    mockFetch({
      searchHandler: () => ({ models: [] }),
      cachedConceptPages: [cachePage(1, 6), cachePage(7, 2)],
      promptVariantRequests,
      promptVariantsGate,
      promptVariantsGateFromBatch: 1,
    });
    vi.stubGlobal("IntersectionObserver", ManualIntersectionObserver);
    renderHome();

    await interactor.type(screen.getByRole("textbox", { name: "Найти или создать модель" }), "ваза с узором");
    await screen.findByRole("button", { name: "Создать 3D: Кэшированная ваза 6" });
    await waitFor(() => expect(infiniteObservers.length).toBeGreaterThan(0));
    infiniteObservers
      .find((observer) => observer.target?.matches(".homeConceptSentinel"))!
      .trigger();

    expect(
      await screen.findByRole("button", { name: "Создать 3D: Кэшированная ваза 8" }),
    ).toBeTruthy();
    expect(promptVariantRequests.at(-1)?.batch).toBe(1);
    expect(screen.queryByText("ваза с узором · Карта созвездий")).toBeNull();

    releaseVariants();
    expect(await screen.findByText("ваза с узором · Ар-деко")).toBeTruthy();
  });

  it("не уводит из домашней страницы даже при длинной выдаче", async () => {
    mockFetch({
      searchHandler: (q) => ({
        models: Array.from({ length: 11 }, (_, index) => model(`result-${index}`, `Модель ${q} ${index}`)),
      }),
    });
    renderHome();
    await screen.findByText("Популярно сейчас · Печатают чаще всего");

    fireEvent.change(screen.getByRole("textbox", { name: "Найти или создать модель" }), { target: { value: "лампа" } });
    expect(await screen.findByText("Модель лампа 0")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Все результаты" })).toBeNull();
    expect(window.location.pathname).toBe("/");
  });

  it("ровно 10 результатов не показывают кнопку полного каталога", async () => {
    const interactor = userEvent.setup();
    mockFetch({
      searchHandler: () => ({ models: Array.from({ length: 10 }, (_, index) => model(`result-${index}`, `Результат ${index}`)) }),
    });
    renderHome();

    await interactor.type(screen.getByRole("textbox", { name: "Найти или создать модель" }), "ваза");

    expect(await screen.findByText("Результат 0")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Все результаты" })).toBeNull();
  });

  it("не показывает неработающую плавающую помощь", async () => {
    mockFetch();
    renderHome();

    await screen.findByText("Популярно сейчас · Печатают чаще всего");
    expect(screen.queryByRole("button", { name: "Помощь" })).toBeNull();
  });

  it("кнопка очистки — видна только при непустом поле, чистит query и ?q=", async () => {
    mockFetch({ searchHandler: (q) => ({ models: [model("d1", `Модель ${q}`)] }) });
    renderHome();
    await screen.findByText("Популярно сейчас · Печатают чаще всего");

    const clear = screen.getByLabelText("Очистить");
    expect(clear.getAttribute("data-visible")).toBeNull();

    fireEvent.change(screen.getByPlaceholderText("Найти или создать модель"), { target: { value: "лампа" } });
    await waitFor(() => expect(clear.getAttribute("data-visible")).toBe("true"));

    fireEvent.click(clear);
    expect(screen.getByPlaceholderText("Найти или создать модель")).toHaveProperty("value", "");
    expect(window.location.search).toBe("");
  });
});
