import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SessionUser } from "@shared/types";
import { DataMaterialsScreen } from "./materiallist.tsx";
import { DataMaterialEditor } from "./materialeditor.tsx";

const materialApi = vi.hoisted(() => ({
  updateAdminMaterial: vi.fn().mockResolvedValue({ id: "material-1", version: 4 }),
  publishAdminMaterial: vi.fn().mockResolvedValue({ id: "material-1", version: 4 }),
  restoreAdminMaterial: vi.fn().mockResolvedValue({ id: "material-1", version: 4 }),
}));

vi.mock("./api.ts", () => ({
  getAdminMaterialOptions: vi.fn().mockResolvedValue({
    vendors: [{ id: "vendor-1", name: "BASF" }],
    material_types: [{ id: "type-1", name: "PLA" }],
  }),
  listAdminMaterials: vi.fn().mockResolvedValue({ items: [], total: 0, limit: 30, offset: 0, has_more: false }),
  createAdminMaterial: vi.fn().mockResolvedValue({ id: "material-1", version: 1 }),
  getAdminMaterial: vi.fn().mockResolvedValue({ id: "material-1", kind: "resin", slug: "sample", name: "Sample", vendor_id: "vendor-1", material_type_id: "type-1", specs: { density: 1.24 }, status: "draft", version: 3 }),
  updateAdminMaterial: materialApi.updateAdminMaterial,
  publishAdminMaterial: materialApi.publishAdminMaterial,
  restoreAdminMaterial: materialApi.restoreAdminMaterial,
  archiveAdminMaterial: vi.fn().mockResolvedValue({ id: "material-1", version: 4 }),
}));
vi.mock("@platform/nav/homeheader.tsx", () => ({ HomeHeader: () => <header>Навигация</header> }));

const user: SessionUser = {
  id: "user-1",
  username: "devuser",
  display_name: "DEV Reviewer",
  avatar_url: null,
  handle_confirmed: true,
  role: "user",
  capabilities: ["data.materials.manage"],
};

afterEach(() => {
  cleanup();
  materialApi.updateAdminMaterial.mockClear();
  materialApi.publishAdminMaterial.mockClear();
  materialApi.restoreAdminMaterial.mockClear();
});

describe("DataMaterialsScreen", () => {
  it("показывает все виды материалов и действие создания", async () => {
    render(<DataMaterialsScreen user={user} section="market" onSectionChange={() => undefined} />);
    expect(await screen.findByRole("heading", { name: "Материалы" })).toBeTruthy();
    for (const label of ["Все", "Филамент", "Смола", "Фанера", "Алюминий"]) {
      expect(screen.getByRole("button", { name: label })).toBeTruthy();
    }
    expect(screen.getByRole("link", { name: "Добавить материал" }).getAttribute("href")).toBe("/data/materials/new");
    expect(screen.getByRole("navigation", { name: "Разделы данных" })).toBeTruthy();
    expect(screen.getAllByRole("heading", { name: "Материалы" })).toHaveLength(1);
  });

  it("восстанавливает архивный материал перед редактированием", async () => {
    const apiModule = await import("./api.ts");
    vi.mocked(apiModule.getAdminMaterial).mockResolvedValueOnce({ id: "material-1", kind: "resin", slug: "sample", name: "Archived", vendor_id: "vendor-1", vendor_name: "BASF", material_type_id: "type-1", material_type_name: "PLA", specs: {}, status: "archived", version: 3, updated_at: "2026-09-14T12:00:00Z" });
    render(<DataMaterialEditor user={user} section="market" onSectionChange={() => undefined} id="material-1" />);
    const restore = await screen.findByRole("button", { name: "Восстановить" });
    expect(screen.getByRole("button", { name: "Сохранить изменения" }).hasAttribute("disabled")).toBe(true);
    await userEvent.setup().click(restore);
    expect(materialApi.restoreAdminMaterial).toHaveBeenCalledWith("material-1", 3);
    expect(screen.getByRole("button", { name: "Сохранить изменения" }).hasAttribute("disabled")).toBe(false);
  });

  it("не раскрывает workspace без capability", async () => {
    render(<DataMaterialsScreen user={{ ...user, capabilities: [] }} section="market" onSectionChange={() => undefined} />);
    expect(await screen.findByText("Недостаточно прав")).toBeTruthy();
  });

  it("даёт создать материал через понятные справочники и объясняет lifecycle", async () => {
    render(<DataMaterialEditor user={user} section="market" onSectionChange={() => undefined} />);
    expect(screen.getByRole("heading", { name: "Новый материал" })).toBeTruthy();
    expect(screen.getByLabelText("Вид материала")).toBeTruthy();
    expect(screen.getByLabelText("Название")).toBeTruthy();
    expect(await screen.findByRole("combobox", { name: "Производитель" })).toBeTruthy();
    expect(screen.getByRole("option", { name: "BASF" })).toBeTruthy();
    expect(screen.getByRole("combobox", { name: "Тип материала" })).toBeTruthy();
    expect(screen.getByRole("option", { name: "PLA" })).toBeTruthy();
    expect(screen.queryByLabelText("Vendor ID")).toBeNull();
    expect(screen.queryByLabelText("Material type ID")).toBeNull();
    expect(screen.queryByLabelText("Характеристики JSON")).toBeNull();
    expect(screen.getByText(/сохраняется как черновик и не виден в публичном каталоге/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Сохранить черновик" })).toBeTruthy();
  });

  it("не разрешает сохранить материал до выбора справочников", async () => {
    render(<DataMaterialEditor user={user} section="market" onSectionChange={() => undefined} />);
    await screen.findByRole("option", { name: "BASF" });
    const submit = screen.getByRole("button", { name: "Сохранить черновик" });
    expect(submit.hasAttribute("disabled")).toBe(true);
    await userEvent.setup().selectOptions(screen.getByRole("combobox", { name: "Производитель" }), "vendor-1");
    await userEvent.setup().selectOptions(screen.getByRole("combobox", { name: "Тип материала" }), "type-1");
    expect(submit.hasAttribute("disabled")).toBe(false);
  });

  it("загружает существующую карточку для редактирования и публикации", async () => {
    render(<DataMaterialEditor user={user} section="market" onSectionChange={() => undefined} id="material-1" />);
    expect(await screen.findByDisplayValue("Sample")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Опубликовать" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Архивировать" })).toBeTruthy();
  });

  it("не очищает технические характеристики при сохранении метаданных", async () => {
    const interaction = userEvent.setup();
    render(<DataMaterialEditor user={user} section="market" onSectionChange={() => undefined} id="material-1" />);
    const name = await screen.findByDisplayValue("Sample");
    await interaction.clear(name);
    await interaction.type(name, "Updated sample");
    await interaction.click(screen.getByRole("button", { name: "Сохранить изменения" }));
    expect(materialApi.updateAdminMaterial).toHaveBeenCalledWith("material-1", {
      version: 3,
      kind: "resin",
      name: "Updated sample",
      vendor_id: "vendor-1",
      material_type_id: "type-1",
    });
  });

  it("публикует материал отдельной lifecycle-командой", async () => {
    render(<DataMaterialEditor user={user} section="market" onSectionChange={() => undefined} id="material-1" />);
    await userEvent.setup().click(await screen.findByRole("button", { name: "Опубликовать" }));
    expect(materialApi.publishAdminMaterial).toHaveBeenCalledWith("material-1", 3);
    expect(materialApi.updateAdminMaterial).not.toHaveBeenCalled();
  });
});
