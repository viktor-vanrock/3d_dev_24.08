import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MakeCreateWizard } from "./makecreate.tsx";
import { MakeDetailScreen } from "./makedetail.tsx";

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.unstubAllGlobals();
});

describe("MakeCreateWizard", () => {
  it("не отправляет форму без фото, принтера и филамента", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ machines: [], materials: [] })));
    vi.stubGlobal("fetch", fetchMock);

    render(<MakeCreateWizard modelId="model-1" modelTitle="Калибровочный куб" onClose={() => {}} onCreated={() => {}} />);
    await user.click(screen.getByRole("button", { name: "Продолжить" }));

    expect(screen.getByRole("alert").textContent).toContain("Добавьте хотя бы одно фото");
    expect((fetchMock.mock.calls as unknown as Array<[RequestInfo | URL, RequestInit?]>).some(([, init]) => init?.method === "POST")).toBe(false);
  });

  it("отправляет реальный multipart с двумя филаментами и JSON-настройками", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/machines?")) return new Response(JSON.stringify({ machines: [{ id: "machine-1", vendor: { name: "Bambu" }, model: "X1C" }] }));
      if (url.includes("/materials?")) {
        return new Response(JSON.stringify({ materials: [
          { id: "mat-1", name: "PLA", vendor: { name: "Brand" }, material_type: { name: "PLA" } },
          { id: "mat-2", name: "PETG", vendor: { name: "Brand" }, material_type: { name: "PETG" } },
        ] }));
      }
      if (url.endsWith("/makes") && init?.method === "POST") return new Response(JSON.stringify({ make: { id: "make-1" } }), { status: 201 });
      return new Response(null, { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const created = vi.fn();

    render(<MakeCreateWizard modelId="model-1" modelTitle="Калибровочный куб" onClose={() => {}} onCreated={created} />);
    await user.upload(screen.getByLabelText("Фото печати"), new File(["image"], "print.jpg", { type: "image/jpeg" }));
    await user.click(screen.getByRole("button", { name: "Продолжить" }));
    await screen.findByRole("option", { name: "Bambu X1C" });
    await user.selectOptions(screen.getByRole("combobox", { name: "Принтер" }), "machine-1");
    await user.click(screen.getByRole("checkbox", { name: "Brand PLA (PLA)" }));
    await user.click(screen.getByRole("checkbox", { name: "Brand PETG (PETG)" }));
    await user.click(screen.getByRole("button", { name: "Продолжить" }));
    await user.type(screen.getByRole("spinbutton", { name: "Сопло, мм" }), "0.4");
    // MF-1962: три независимых шкалы — печатаемость проекта/геометрия модели/поверхность
    // отпечатка, не одна общая «оценка».
    await user.click(screen.getByRole("radio", { name: "5 звёзд — печатаемость проекта" }));
    await user.click(screen.getByRole("radio", { name: "4 звёзд — геометрия и стыки модели" }));
    await user.click(screen.getByRole("radio", { name: "3 звёзд — качество поверхности отпечатка" }));
    await user.click(screen.getByRole("button", { name: "Опубликовать печать" }));

    const call = fetchMock.mock.calls.find(([url, init]) => String(url).endsWith("/makes") && init?.method === "POST");
    expect(call).toBeTruthy();
    const body = call?.[1]?.body as FormData;
    expect(body.getAll("photos")).toHaveLength(1);
    expect(body.get("material_ids")).toBe("mat-1,mat-2");
    expect(JSON.parse(String(body.get("print_settings")))).toMatchObject({ nozzle_mm: 0.4 });
    expect(body.get("printability_rating")).toBe("5");
    expect(body.get("geometry_quality_rating")).toBe("4");
    expect(body.get("surface_quality_rating")).toBe("3");
    expect(created).toHaveBeenCalledWith("make-1");
  });
});

describe("MakeDetailScreen", () => {
  it("показывает все фото, спецификацию и связанные печати", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      id: "make-1",
      model_id: "model-1",
      model_title: "Калибровочный куб",
      author: { username: "maker", display_name: "Мейкер" },
      machine_model: "Bambu X1C",
      materials: [{ id: "mat-1", name: "PLA" }],
      photos: [{ id: "photo-1", position: 0, is_cover: true, moderation_status: "approved" }],
      print_settings: { nozzle_mm: 0.4, layer_height_mm: 0.2 },
      printability_rating: 5,
      issue_tags: [],
      notes: "Без поддержек",
      more_prints_of_model: [{ id: "make-2", caption: "Вторая печать", author: { username: "other" }, material_ids: [], issue_tags: [], likes_count: 0, comments_count: 0, reposts_count: 0, views_count: 0 }],
      same_material_prints: [],
    }))));

    render(<MakeDetailScreen id="make-1" />);

    expect(await screen.findByRole("heading", { name: "Калибровочный куб" })).toBeTruthy();
    expect(screen.getByRole("img", { name: "Фото печати 1" })).toBeTruthy();
    expect(screen.getByText("Bambu X1C")).toBeTruthy();
    expect(screen.getByText("Сопло, мм")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Ещё печати этой модели" })).toBeTruthy();
  });
});
