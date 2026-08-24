import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { OverlayProvider } from "@platform/overlay";
import { MyCatalogsSection } from "./profile.catalogs.tsx";

// «Мои принтеры»/«Мои филаменты» в ЛК (Фаза 3 MF-359) — тот же приём тестирования, что
// push.settings.test.tsx (реальный OverlayProvider, mock fetch по URL).

function mockFetch(routes: Record<string, { status?: number; body?: unknown }>) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const match = Object.entries(routes).find(([candidate]) => url.includes(candidate));
      if (!match) return new Response(null, { status: 404 });
      const { status = 200, body } = match[1];
      return new Response(body === undefined ? null : JSON.stringify(body), { status });
    }),
  );
}

function renderSection() {
  return render(
    <OverlayProvider>
      <MyCatalogsSection />
    </OverlayProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("MyCatalogsSection", () => {
  it("пустые каталоги — empty state с CTA на оба раздела", async () => {
    mockFetch({ "/me/activation": { body: { activation: { state: "returning" }, printers: [], filaments: [] } } });
    renderSection();
    await waitFor(() => expect(screen.getByText("Здесь появятся ваши принтеры")).toBeTruthy());
    expect(screen.getByText("Здесь появятся ваши филаменты")).toBeTruthy();
    expect(screen.getByText("Добавить принтер")).toBeTruthy();
    expect(screen.getByText("Добавить филамент")).toBeTruthy();
  });

  it("непустые каталоги — рендерит строки со счётчиком", async () => {
    mockFetch({
      "/me/activation": {
        body: {
          activation: { state: "returning" },
          printers: [{ id: "p1", brand: "Bambu Lab", model: "A1 mini", is_primary: true, verified: true }],
          filaments: [{ id: "f1", material_id: "m1", name: "PLA Basic", brand: "Bambu Lab", material_type: "pla" }],
        },
      },
    });
    renderSection();
    await waitFor(() => expect(screen.getByText("Мои принтеры · 1")).toBeTruthy());
    expect(screen.getByText("Мои филаменты · 1")).toBeTruthy();
    expect(screen.getByText("Bambu Lab A1 mini")).toBeTruthy();
    expect(screen.getByText("Bambu Lab PLA Basic")).toBeTruthy();
  });

  it("модель/имя уже содержит бренд — строка не дублирует его (тот же дедуп, что PrinterPicker/MaterialPicker)", async () => {
    mockFetch({
      "/me/activation": {
        body: {
          activation: { state: "returning" },
          printers: [{ id: "p1", brand: "Agent", model: "Agent printer", is_primary: false, verified: true }],
          filaments: [{ id: "f1", material_id: "m1", name: "Bestfilament PLA", brand: "Bestfilament", material_type: "pla" }],
        },
      },
    });
    renderSection();
    await waitFor(() => expect(screen.getByText("Agent printer")).toBeTruthy());
    expect(screen.queryByText("Agent Agent printer")).toBeNull();
    expect(screen.getByText("Bestfilament PLA")).toBeTruthy();
    expect(screen.queryByText("Bestfilament Bestfilament PLA")).toBeNull();
  });

  it("удаление принтера — подтверждение → DELETE → строка исчезает", async () => {
    mockFetch({
      "/me/activation": {
        body: {
          activation: { state: "returning" },
          printers: [{ id: "p1", brand: "Bambu Lab", model: "A1 mini", is_primary: true, verified: true }],
          filaments: [],
        },
      },
      "/me/printers/p1": { status: 200 },
    });
    renderSection();
    await waitFor(() => expect(screen.getByText("Bambu Lab A1 mini")).toBeTruthy());

    fireEvent.click(screen.getByLabelText("Убрать Bambu Lab A1 mini"));
    await waitFor(() => expect(screen.getByText("Убрать принтер?")).toBeTruthy());
    fireEvent.click(screen.getByText("Убрать"));

    await waitFor(() => expect(screen.queryByText("Bambu Lab A1 mini")).toBeNull());
    const deleteCall = vi.mocked(fetch).mock.calls.find(([input, init]) => String(input).includes("/me/printers/p1") && init?.method === "DELETE");
    expect(deleteCall).toBeTruthy();
  });

  it("тап по строке принтера открывает редактирование; тап по корзине — только удаление (MF-939)", async () => {
    mockFetch({
      "/me/activation": {
        body: {
          activation: { state: "returning" },
          printers: [{ id: "p1", brand: "Bambu Lab", model: "A1 mini", is_primary: true, verified: true }],
          filaments: [],
        },
      },
    });
    renderSection();
    await waitFor(() => expect(screen.getByText("Bambu Lab A1 mini")).toBeTruthy());

    fireEvent.click(screen.getByLabelText("Убрать Bambu Lab A1 mini"));
    await waitFor(() => expect(screen.getByText("Убрать принтер?")).toBeTruthy());
    expect(screen.queryByText("Изменить принтер")).toBeNull();
    fireEvent.click(screen.getByText("Отмена"));

    fireEvent.click(screen.getByLabelText('Изменить «Bambu Lab A1 mini»'));
    await waitFor(() => expect(screen.getByText("Изменить принтер")).toBeTruthy());
  });

  it("каталожный принтер — Бренд/Модель приглушены и нередактируемы, ручной — все поля открыты (MF-939)", async () => {
    mockFetch({
      "/me/activation": {
        body: {
          activation: { state: "returning" },
          printers: [
            { id: "p1", brand: "Bambu Lab", model: "A1 mini", is_primary: true, verified: true },
            { id: "p2", brand: "Homebrew", model: "Voron 2.4", is_primary: false, verified: false },
          ],
          filaments: [],
        },
      },
    });
    renderSection();
    await waitFor(() => expect(screen.getByText("Bambu Lab A1 mini")).toBeTruthy());

    fireEvent.click(screen.getByText("Bambu Lab A1 mini"));
    await waitFor(() => expect(screen.getByText("Изменить принтер")).toBeTruthy());
    expect(screen.queryByPlaceholderText("Бренд")).toBeNull();
    expect(screen.getByText("Bambu Lab")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Закрыть"));
    await waitFor(() => expect(screen.queryByText("Изменить принтер")).toBeNull());

    fireEvent.click(screen.getByText("Homebrew Voron 2.4"));
    await waitFor(() => expect(screen.getByText("Изменить принтер")).toBeTruthy());
    expect(screen.getByPlaceholderText("Бренд")).toBeTruthy();
  });

  it("сохранение принтера — PATCH → строка обновляется из ответа, модалка закрывается (MF-939)", async () => {
    mockFetch({
      "/me/activation": {
        body: {
          activation: { state: "returning" },
          printers: [{ id: "p1", brand: "Prusa", model: "MK4", is_primary: true, verified: false }],
          filaments: [],
        },
      },
      "/me/printers/p1": {
        status: 200,
        body: { printer: { id: "p1", brand: "Prusa", model: "MK4S", is_primary: true, verified: false } },
      },
    });
    renderSection();
    await waitFor(() => expect(screen.getByText("Prusa MK4")).toBeTruthy());

    fireEvent.click(screen.getByText("Prusa MK4"));
    await waitFor(() => expect(screen.getByText("Изменить принтер")).toBeTruthy());
    fireEvent.change(screen.getByPlaceholderText("Модель"), { target: { value: "MK4S" } });
    fireEvent.click(screen.getByText("Сохранить"));

    await waitFor(() => expect(screen.queryByText("Изменить принтер")).toBeNull());
    expect(screen.getByText("Prusa MK4S")).toBeTruthy();
    const patchCall = vi
      .mocked(fetch)
      .mock.calls.find(([input, init]) => String(input).includes("/me/printers/p1") && init?.method === "PATCH");
    expect(patchCall).toBeTruthy();
  });

  it("ошибка сохранения принтера — toast, модалка остаётся открытой (MF-939 §4)", async () => {
    mockFetch({
      "/me/activation": {
        body: {
          activation: { state: "returning" },
          printers: [{ id: "p1", brand: "Prusa", model: "MK4", is_primary: true, verified: false }],
          filaments: [],
        },
      },
      "/me/printers/p1": { status: 500 },
    });
    renderSection();
    await waitFor(() => expect(screen.getByText("Prusa MK4")).toBeTruthy());

    fireEvent.click(screen.getByText("Prusa MK4"));
    await waitFor(() => expect(screen.getByText("Изменить принтер")).toBeTruthy());
    fireEvent.click(screen.getByText("Сохранить"));

    await waitFor(() => expect(screen.getByText("Не удалось сохранить")).toBeTruthy());
    expect(screen.getByText("Изменить принтер")).toBeTruthy();
  });

  it("«Сделать основным» — PATCH is_primary → старый основной теряет метку, новый становится первым (MF-939 §2)", async () => {
    mockFetch({
      "/me/activation": {
        body: {
          activation: { state: "returning" },
          printers: [
            { id: "p1", brand: "Bambu Lab", model: "A1 mini", is_primary: true, verified: true },
            { id: "p2", brand: "Prusa", model: "MK4", is_primary: false, verified: false },
          ],
          filaments: [],
        },
      },
      "/me/printers/p2": {
        status: 200,
        body: { printer: { id: "p2", brand: "Prusa", model: "MK4", is_primary: true, verified: false } },
      },
    });
    renderSection();
    await waitFor(() => expect(screen.getByText("Prusa MK4")).toBeTruthy());

    fireEvent.click(screen.getByText("Prusa MK4"));
    await waitFor(() => expect(screen.getByText("Сделать основным")).toBeTruthy());
    fireEvent.click(screen.getByText("Сделать основным"));

    await waitFor(() => expect(screen.queryByText("Изменить принтер")).toBeNull());
    const titles = screen.getAllByText(/^(Bambu Lab A1 mini|Prusa MK4)$/).map((node) => node.textContent);
    expect(titles).toEqual(["Prusa MK4", "Bambu Lab A1 mini"]);
    // Bambu Lab больше не основной (сервер снял метку) — теперь у него есть кнопка «Сделать основным».
    fireEvent.click(screen.getByText("Bambu Lab A1 mini"));
    await waitFor(() => expect(screen.getByText("Сделать основным")).toBeTruthy());
  });

  it("модалка добавления принтера не вкладывает Card и показывает вторичные действия кнопками", async () => {
    const user = userEvent.setup();
    mockFetch({ "/me/activation": { body: { activation: { state: "returning" }, printers: [], filaments: [] } } });
    renderSection();
    await user.click(await screen.findByRole("button", { name: "Добавить принтер" }));

    const dialog = await screen.findByRole("dialog", { name: "Добавить принтер" });
    expect(dialog.querySelector(".uiCard")).toBeNull();
    for (const name of ["Позже", "Не нашли? Указать вручную"]) {
      const action = within(dialog).getByRole("button", { name });
      expect(action.getAttribute("data-variant")).toBe("secondary");
      expect(action.querySelector("svg[aria-hidden='true']")).toBeTruthy();
    }
  });

  it("добавление филамента через MaterialPicker — чип → POST /me/filaments → строка в списке", async () => {
    mockFetch({
      "/me/activation": { body: { activation: { state: "returning" }, printers: [], filaments: [] } },
      "/materials?kind=filament&type=pla": {
        body: { materials: [{ id: "m1", name: "PLA Basic", vendor: { name: "Bambu Lab" }, material_type: { slug: "pla" } }] },
      },
      "/materials?kind=filament&type=petg": { body: { materials: [] } },
      "/me/filaments": { status: 201, body: { filament: { id: "f1", material_id: "m1" } } },
    });
    renderSection();
    await waitFor(() => expect(screen.getByText("Добавить филамент")).toBeTruthy());
    fireEvent.click(screen.getByText("Добавить филамент"));
    const dialog = await screen.findByRole("dialog", { name: "Добавить филамент" });
    expect(dialog.querySelector(".uiCard")).toBeNull();
    await waitFor(() => expect(screen.getByText("Bambu Lab PLA Basic")).toBeTruthy());
    fireEvent.click(screen.getByText("Bambu Lab PLA Basic"));
    await waitFor(() => expect(screen.getByText("Мои филаменты · 1")).toBeTruthy());
  });

  it("тап по строке филамента открывает редактирование; тап по корзине — только удаление (MF-951)", async () => {
    mockFetch({
      "/me/activation": {
        body: {
          activation: { state: "returning" },
          printers: [],
          filaments: [{ id: "f1", material_id: "m1", name: "PLA Basic", brand: "Bambu Lab", material_type: "pla" }],
        },
      },
      "/materials/m1": { body: { material: { variants: [] } } },
    });
    renderSection();
    await waitFor(() => expect(screen.getByText("Bambu Lab PLA Basic")).toBeTruthy());

    fireEvent.click(screen.getByLabelText("Убрать Bambu Lab PLA Basic"));
    await waitFor(() => expect(screen.getByText("Убрать филамент?")).toBeTruthy());
    expect(screen.queryByText("Изменить филамент")).toBeNull();
    fireEvent.click(screen.getByText("Отмена"));

    fireEvent.click(screen.getByLabelText('Изменить «Bambu Lab PLA Basic»'));
    await waitFor(() => expect(screen.getByText("Изменить филамент")).toBeTruthy());
  });

  it("материал без вариантов — блока чипов нет; заметка сохраняется через PATCH (MF-951 §3)", async () => {
    mockFetch({
      "/me/activation": {
        body: {
          activation: { state: "returning" },
          printers: [],
          filaments: [{ id: "f1", material_id: "m1", name: "PLA Basic", brand: "Bambu Lab", material_type: "pla" }],
        },
      },
      "/materials/m1": { body: { material: { variants: [] } } },
      "/me/filaments/f1": {
        status: 200,
        body: { filament: { id: "f1", material_id: "m1", variant_id: null, note: "партия 03.2026" } },
      },
    });
    renderSection();
    await waitFor(() => expect(screen.getByText("Bambu Lab PLA Basic")).toBeTruthy());

    fireEvent.click(screen.getByText("Bambu Lab PLA Basic"));
    await waitFor(() => expect(screen.getByText("Изменить филамент")).toBeTruthy());
    expect(screen.queryByText("Цвет/вариант")).toBeNull();

    fireEvent.change(screen.getByLabelText("Заметка о филаменте"), { target: { value: "партия 03.2026" } });
    fireEvent.click(screen.getByText("Сохранить"));

    await waitFor(() => expect(screen.queryByText("Изменить филамент")).toBeNull());
    const patchCall = vi
      .mocked(fetch)
      .mock.calls.find(([input, init]) => String(input).includes("/me/filaments/f1") && init?.method === "PATCH");
    expect(patchCall).toBeTruthy();
    expect(JSON.parse(String(patchCall?.[1]?.body))).toEqual({ variant_id: null, note: "партия 03.2026" });
  });

  it("материал с вариантами — чип выбирает цвет, строка показывает цвет после сохранения (MF-951 §3)", async () => {
    mockFetch({
      "/me/activation": {
        body: {
          activation: { state: "returning" },
          printers: [],
          filaments: [{ id: "f1", material_id: "m1", name: "PLA Basic", brand: "Bambu Lab", material_type: "pla" }],
        },
      },
      "/materials/m1": {
        body: { material: { variants: [{ id: "v1", color_name: "Red", color_hex: "#ff0000", diameter_mm: 1.75 }] } },
      },
      "/me/filaments/f1": {
        status: 200,
        body: { filament: { id: "f1", material_id: "m1", variant_id: "v1", note: null } },
      },
    });
    renderSection();
    await waitFor(() => expect(screen.getByText("Bambu Lab PLA Basic")).toBeTruthy());

    fireEvent.click(screen.getByText("Bambu Lab PLA Basic"));
    await waitFor(() => expect(screen.getByText("Red")).toBeTruthy());
    fireEvent.click(screen.getByText("Red"));
    fireEvent.click(screen.getByText("Сохранить"));

    await waitFor(() => expect(screen.queryByText("Изменить филамент")).toBeNull());
    expect(screen.getByText("Red")).toBeTruthy();
  });

  it("ошибка сохранения филамента — toast, модалка остаётся открытой (MF-951 §4)", async () => {
    mockFetch({
      "/me/activation": {
        body: {
          activation: { state: "returning" },
          printers: [],
          filaments: [{ id: "f1", material_id: "m1", name: "PLA Basic", brand: "Bambu Lab", material_type: "pla" }],
        },
      },
      "/materials/m1": { body: { material: { variants: [] } } },
      "/me/filaments/f1": { status: 500 },
    });
    renderSection();
    await waitFor(() => expect(screen.getByText("Bambu Lab PLA Basic")).toBeTruthy());

    fireEvent.click(screen.getByText("Bambu Lab PLA Basic"));
    await waitFor(() => expect(screen.getByText("Изменить филамент")).toBeTruthy());
    fireEvent.click(screen.getByText("Сохранить"));

    await waitFor(() => expect(screen.getByText("Не удалось сохранить")).toBeTruthy());
    expect(screen.getByText("Изменить филамент")).toBeTruthy();
  });

  it("удаление филамента — подтверждение → DELETE → строка исчезает", async () => {
    mockFetch({
      "/me/activation": {
        body: {
          activation: { state: "returning" },
          printers: [],
          filaments: [{ id: "f1", material_id: "m1", name: "PLA Basic", brand: "Bambu Lab", material_type: "pla" }],
        },
      },
      "/me/filaments/f1": { status: 200 },
    });
    renderSection();
    await waitFor(() => expect(screen.getByText("Bambu Lab PLA Basic")).toBeTruthy());

    fireEvent.click(screen.getByLabelText("Убрать Bambu Lab PLA Basic"));
    await waitFor(() => expect(screen.getByText("Убрать филамент?")).toBeTruthy());
    fireEvent.click(screen.getByText("Убрать"));

    await waitFor(() => expect(screen.queryByText("Bambu Lab PLA Basic")).toBeNull());
    const deleteCall = vi
      .mocked(fetch)
      .mock.calls.find(([input, init]) => String(input).includes("/me/filaments/f1") && init?.method === "DELETE");
    expect(deleteCall).toBeTruthy();
  });
});
