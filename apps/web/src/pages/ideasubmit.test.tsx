import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { OverlayProvider } from "@platform/overlay";
import { ThemeProvider } from "@platform/theme";
import type { SessionUser } from "@domains/access";
import { IdeaSubmitScreen } from "./ideasubmit.tsx";

// Форма подачи идеи (MF-947, docs/design/ideas.md §4/§4.7) — покрываем инварианты приёмки:
// лимит заголовка, обязательная категория, лимит-исчерпан дизейблит подачу, успех/сеть-ошибка.

const user: SessionUser = { id: "u1", username: "tester", display_name: null, avatar_url: null, handle_confirmed: true, role: "user" };

function mockFetch(routes: Record<string, (input: RequestInfo | URL, init?: RequestInit) => Response> | Record<string, unknown>) {
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const key = Object.keys(routes).find((candidate) => url.includes(candidate));
    if (!key) return new Response(JSON.stringify({ items: [] }), { status: 200 });
    const value = (routes as Record<string, unknown>)[key];
    if (typeof value === "function") return (value as (i: RequestInfo | URL, init?: RequestInit) => Response)(input, init);
    return new Response(JSON.stringify(value), { status: 200 });
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

function renderScreen() {
  return render(
    <ThemeProvider>
      <OverlayProvider>
        <IdeaSubmitScreen user={user} />
      </OverlayProvider>
    </ThemeProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("IdeaSubmitScreen (MF-947)", () => {
  it("заголовок пуст — «Опубликовать идею» задизейблена", async () => {
    mockFetch({ "/ideas/mine": { items: [], next_cursor: null } });
    renderScreen();
    const submit = await screen.findByText("Опубликовать идею");
    expect(submit.closest("button")?.disabled).toBe(true);
  });

  it("заголовок >120 символов — счётчик красным, подача задизейблена", async () => {
    mockFetch({ "/ideas/mine": { items: [], next_cursor: null } });
    renderScreen();
    const input = await screen.findByPlaceholderText("О чём ваша идея?");
    fireEvent.change(input, { target: { value: "a".repeat(121) } });
    const counter = await screen.findByText("121/120");
    expect(counter.getAttribute("data-over")).toBe("true");
    const submit = screen.getByText("Опубликовать идею").closest("button");
    expect(submit?.disabled).toBe(true);
  });

  it("категория не выбрана — подача задизейблена даже с валидным заголовком", async () => {
    mockFetch({ "/ideas/mine": { items: [], next_cursor: null } });
    renderScreen();
    const input = await screen.findByPlaceholderText("О чём ваша идея?");
    fireEvent.change(input, { target: { value: "Хочу фильтр по цвету" } });
    const submit = screen.getByText("Опубликовать идею").closest("button");
    expect(submit?.disabled).toBe(true);
  });

  it("лимит 3/сутки исчерпан — форма дизейблится заранее с текстом §4.5", async () => {
    const now = new Date().toISOString();
    mockFetch({
      "/ideas/mine": {
        items: [
          { id: "i1", title: "a", type: "idea", status: "proposed", vote_count: 0, created_at: now, last_activity_at: now },
          { id: "i2", title: "b", type: "idea", status: "proposed", vote_count: 0, created_at: now, last_activity_at: now },
          { id: "i3", title: "c", type: "idea", status: "proposed", vote_count: 0, created_at: now, last_activity_at: now },
        ],
        next_cursor: null,
      },
    });
    renderScreen();
    await waitFor(() => expect(screen.getAllByText("Лимит на сегодня исчерпан — вернитесь завтра").length).toBeGreaterThan(0));
  });

  it("успешная отправка показывает hero-успех «Идея опубликована»", async () => {
    mockFetch({
      "/ideas/mine": { items: [], next_cursor: null },
      "/ideas/similar": { items: [] },
      "/ideas": () => new Response(JSON.stringify({ id: "new-idea-1" }), { status: 201 }),
    });
    renderScreen();
    const input = await screen.findByPlaceholderText("О чём ваша идея?");
    fireEvent.change(input, { target: { value: "Хочу фильтр по цвету" } });
    fireEvent.click(screen.getByText("Каталог"));
    const submit = await waitFor(() => {
      const btn = screen.getByText("Опубликовать идею").closest("button");
      expect(btn?.disabled).toBe(false);
      return btn as HTMLButtonElement;
    });
    fireEvent.click(submit);
    expect(await screen.findByText("Идея опубликована")).toBeTruthy();
  });

  it("сетевая/500-ошибка — текст §4.7 без сброса полей", async () => {
    mockFetch({
      "/ideas/mine": { items: [], next_cursor: null },
      "/ideas/similar": { items: [] },
      "/ideas": () => new Response(JSON.stringify({ error: "INTERNAL" }), { status: 500 }),
    });
    renderScreen();
    const input = await screen.findByPlaceholderText("О чём ваша идея?");
    fireEvent.change(input, { target: { value: "Хочу фильтр по цвету" } });
    fireEvent.click(screen.getByText("Каталог"));
    const submit = await waitFor(() => {
      const btn = screen.getByText("Опубликовать идею").closest("button");
      expect(btn?.disabled).toBe(false);
      return btn as HTMLButtonElement;
    });
    fireEvent.click(submit);
    expect(await screen.findByText("Не удалось опубликовать. Попробуйте ещё раз")).toBeTruthy();
    expect((input as HTMLInputElement).value).toBe("Хочу фильтр по цвету");
  });
});

describe("IdeaSubmitScreen — контекст-предзаполнение (MF-694, docs/design/feedback.entrypoints.md §3/§4)", () => {
  afterEach(() => {
    window.history.pushState({}, "", "/issue/new");
  });

  it("дверь problem+ref предзаполняет поля без дублирующей плашки контекста", async () => {
    window.history.pushState(
      {},
      "",
      "/issue/new?title=%D0%91%D0%B8%D1%82%D0%B0%D1%8F+%D1%81%D1%81%D1%8B%D0%BB%D0%BA%D0%B0&category=catalog&type=problem&ref_type=model&ref_id=42&ref_title=%D0%94%D0%B5%D1%80%D0%B6%D0%B0%D1%82%D0%B5%D0%BB%D1%8C+v2",
    );
    mockFetch({ "/ideas/mine": { items: [], next_cursor: null } });
    renderScreen();
    const input = await screen.findByPlaceholderText("О чём ваша идея?");
    expect((input as HTMLInputElement).value).toBe("Битая ссылка");
    expect(screen.queryByText("Из карточки: «Держатель v2»")).toBeNull();
    expect((screen.getByRole("combobox", { name: "Тип обращения" }) as HTMLSelectElement).value).toBe("problem");
    const submit = await waitFor(() => {
      const btn = screen.getByText("Опубликовать идею").closest("button");
      expect(btn?.disabled).toBe(false);
      return btn as HTMLButtonElement;
    });
    expect(submit.disabled).toBe(false);
  });

  it("дропдаун переключает тип обратно на «Идея»", async () => {
    const userEventApi = userEvent.setup();
    window.history.pushState({}, "", "/issue/new?type=problem");
    mockFetch({ "/ideas/mine": { items: [], next_cursor: null } });
    renderScreen();
    const select = screen.getByRole("combobox", { name: "Тип обращения" });

    await userEventApi.selectOptions(select, "idea");

    expect((select as HTMLSelectElement).value).toBe("idea");
    expect(screen.queryByText(/не попадает в общую ленту голосования/)).toBeNull();
  });
});

describe("IdeaSubmitScreen — дизайн-ревью MF-1753", () => {
  it("показывает категории едиными чипсами и редактор без предпросмотра", async () => {
    mockFetch({ "/ideas/mine": { items: [], next_cursor: null } });
    const { container } = renderScreen();

    expect(container.querySelector("main.ideaSubmitScreen")).toBeTruthy();
    const catalog = await screen.findByRole("button", { name: "Каталог" });
    expect(catalog.getAttribute("aria-pressed")).toBe("false");
    expect(screen.queryByText("Предпросмотр")).toBeNull();
    expect(screen.getByText("Описание — до 50 КБ. Картинки к обращению пока нельзя прикрепить.")).toBeTruthy();
    expect(screen.queryByText("0/50 КБ")).toBeNull();
  });
});

// AI-обогащение подачи (MF-565/MF-1862, docs/epics/ideas.page.md § «2.1») — POST /ideas/enrich
// подставляет черновик title/body/category, деградация 503/502 дизейблит кнопку, 429 показывает
// лимит, ai_assisted уходит в POST /ideas только когда черновик реально применили.
describe("IdeaSubmitScreen — AI-обогащение подачи (MF-1862)", () => {
  async function openAiPanelAndType(freeText: string) {
    const openButton = await screen.findByText("Оформить с ИИ");
    fireEvent.click(openButton);
    const textarea = await screen.findByLabelText("Опишите свободно, чего не хватает");
    fireEvent.change(textarea, { target: { value: freeText } });
    return textarea;
  }

  it("успешный черновик подставляет title/body/category, ai_assisted уходит в POST /ideas", async () => {
    const fetchMock = mockFetch({
      "/ideas/enrich": () =>
        new Response(JSON.stringify({ title: "Фильтр по цвету в каталоге", body: "Не хватает фильтра по цвету", category: "catalog" }), {
          status: 200,
        }),
      "/ideas/mine": { items: [], next_cursor: null },
      "/ideas/similar": { items: [] },
      "/ideas": () => new Response(JSON.stringify({ id: "new-idea-1" }), { status: 201 }),
    });
    renderScreen();

    await openAiPanelAndType("хочу фильтровать каталог по цвету");
    fireEvent.click(screen.getByText("Заполнить с ИИ"));

    const input = await screen.findByPlaceholderText("О чём ваша идея?");
    await waitFor(() => expect((input as HTMLInputElement).value).toBe("Фильтр по цвету в каталоге"));
    expect((screen.getByLabelText("Описание (необязательно)") as HTMLTextAreaElement).value).toBe("Не хватает фильтра по цвету");
    const catalog = screen.getByRole("button", { name: "Каталог" });
    expect(catalog.getAttribute("aria-pressed")).toBe("true");

    const submit = await waitFor(() => {
      const btn = screen.getByText("Опубликовать идею").closest("button");
      expect(btn?.disabled).toBe(false);
      return btn as HTMLButtonElement;
    });
    fireEvent.click(submit);
    await screen.findByText("Идея опубликована");

    const submitCall = fetchMock.mock.calls.find(([reqInput]) => String(reqInput).endsWith("/ideas"));
    expect(submitCall).toBeTruthy();
    const submitBody = JSON.parse((submitCall?.[1] as RequestInit).body as string);
    expect(submitBody.ai_assisted).toBe(true);
  });

  it("пустой title в черновике не подставляется в поле заголовка", async () => {
    mockFetch({
      "/ideas/enrich": () => new Response(JSON.stringify({ title: "", body: "Черновик описания", category: "forum" }), { status: 200 }),
      "/ideas/mine": { items: [], next_cursor: null },
    });
    renderScreen();

    const input = await screen.findByPlaceholderText("О чём ваша идея?");
    await openAiPanelAndType("непонятный текст");
    fireEvent.click(screen.getByText("Заполнить с ИИ"));

    await waitFor(() => expect((screen.getByLabelText("Описание (необязательно)") as HTMLTextAreaElement).value).toBe("Черновик описания"));
    expect((input as HTMLInputElement).value).toBe("");
  });

  it("503 от /ideas/enrich деградирует: кнопка дизейблится, форма работает как в v1", async () => {
    mockFetch({
      "/ideas/enrich": () => new Response(JSON.stringify({ error: "GIGA_UNAVAILABLE" }), { status: 503 }),
      "/ideas/mine": { items: [], next_cursor: null },
    });
    renderScreen();

    await openAiPanelAndType("хочу фильтровать каталог по цвету");
    fireEvent.click(screen.getByText("Заполнить с ИИ"));

    const aiButton = await waitFor(() => {
      const btn = screen.getByText("Оформить с ИИ").closest("button");
      expect(btn?.disabled).toBe(true);
      return btn as HTMLButtonElement;
    });
    expect(aiButton).toBeTruthy();
    expect(await screen.findByText("Сейчас недоступно — заполните вручную")).toBeTruthy();

    const input = await screen.findByPlaceholderText("О чём ваша идея?");
    fireEvent.change(input, { target: { value: "Хочу фильтр по цвету" } });
    fireEvent.click(screen.getByText("Каталог"));
    const submit = await waitFor(() => {
      const btn = screen.getByText("Опубликовать идею").closest("button");
      expect(btn?.disabled).toBe(false);
      return btn as HTMLButtonElement;
    });
    expect(submit.disabled).toBe(false);
  });

  it("429 от /ideas/enrich показывает понятный текст лимита", async () => {
    mockFetch({
      "/ideas/enrich": () => new Response(JSON.stringify({ error: "RATE_LIMITED", limit: 10 }), { status: 429 }),
      "/ideas/mine": { items: [], next_cursor: null },
    });
    renderScreen();

    await openAiPanelAndType("хочу фильтровать каталог по цвету");
    fireEvent.click(screen.getByText("Заполнить с ИИ"));

    expect(await screen.findByText("Лимит обогащений на сегодня исчерпан")).toBeTruthy();
  });
});
