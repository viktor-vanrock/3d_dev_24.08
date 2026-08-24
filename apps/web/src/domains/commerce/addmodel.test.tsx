import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { OverlayApi } from "@platform/overlay";
import { AddModelFlow } from "./addmodel.tsx";
import { AuxFileError, deleteAuxFile, uploadAuxFile } from "./models.ts";

vi.mock("./models.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./models.ts")>();
  return { ...actual, uploadAuxFile: vi.fn(), deleteAuxFile: vi.fn(), updateModel: vi.fn() };
});

afterEach(() => {
  cleanup();
  vi.mocked(uploadAuxFile).mockReset();
  vi.mocked(deleteAuxFile).mockReset();
});

function fakeOverlay(): OverlayApi {
  return {
    toast: vi.fn(() => ({ update: vi.fn(), dismiss: vi.fn() })),
    confirm: vi.fn(async () => true),
    modal: vi.fn(),
    sheet: vi.fn(),
    alert: vi.fn(),
    notifications: {} as OverlayApi["notifications"],
  };
}

function editableModel(overrides: Partial<Parameters<typeof AddModelFlow>[0]["model"]> = {}) {
  return {
    id: "m1",
    title: "Проект",
    description: "",
    tags: [],
    repo_url: null,
    recommended_material: null,
    auxFiles: [],
    ...overrides,
  };
}

function docFile(name = "manual.pdf") {
  return new File(["fake-bytes"], name, { type: "application/pdf" });
}

function sourceFile(path: string) {
  const file = new File(["fake-source"], path.split("/").at(-1) ?? path);
  Object.defineProperty(file, "webkitRelativePath", { value: path });
  return file;
}

describe("AddModelFlow — прогрессивный источник", () => {
  it("does not ask for project metadata before a source is selected", () => {
    render(<AddModelFlow overlay={fakeOverlay()} mode="create" onClose={() => {}} />);
    expect(screen.getByText("Добавьте то, что уже есть")).toBeTruthy();
    expect(screen.queryByLabelText("Название")).toBeNull();
    expect(screen.queryByText("Теги")).toBeNull();
  });

  it("recognises a prepared folder and proposes its folder name", async () => {
    const { container } = render(<AddModelFlow overlay={fakeOverlay()} mode="create" onClose={() => {}} />);
    const input = container.querySelector('[data-testid="projectFolderInput"]') as HTMLInputElement;

    fireEvent.change(input, {
      target: {
        files: [
          sourceFile("robot/print/base.stl"),
          sourceFile("robot/make/README.md"),
          sourceFile("robot/portal.project.yaml"),
        ],
      },
    });

    expect(await screen.findByText("Подготовлено для Portal")).toBeTruthy();
    expect((screen.getByLabelText("Название") as HTMLInputElement).value).toBe("robot");
    expect(screen.getByText("make/README")).toBeTruthy();
  });
});

// Доп-файлы проекта (роль aux, MF-339 шаг 2 / MF-341): редактор карточки модели умеет
// грузить/удалять произвольные доп-файлы через git-контракт POST/DELETE /models/:id/files —
// только в режиме edit, где карточка уже существует.
describe("AddModelFlow — доп. файлы (aux)", () => {
  it("does not render the aux files field in create mode", () => {
    render(<AddModelFlow overlay={fakeOverlay()} mode="create" onClose={() => {}} />);
    expect(screen.queryByText("Доп. файлы (необязательно)")).toBeNull();
  });

  it("renders already-attached aux files in edit mode", () => {
    const model = editableModel({
      auxFiles: [{ id: "f1", role: "aux", original_filename: "manual.pdf", mime_type: "application/pdf", size_bytes: 2048 }],
    });
    render(<AddModelFlow overlay={fakeOverlay()} mode="edit" model={model} onClose={() => {}} />);
    expect(screen.getByText("manual.pdf")).toBeTruthy();
  });

  it("uploads a picked file and adds it to the list", async () => {
    vi.mocked(uploadAuxFile).mockResolvedValue({
      id: "f2",
      role: "aux",
      original_filename: "drawing.dxf",
      mime_type: null,
      size_bytes: 512,
    });
    const model = editableModel();
    const { container } = render(<AddModelFlow overlay={fakeOverlay()} mode="edit" model={model} onClose={() => {}} />);

    const input = container.querySelector('[data-testid="auxFileInput"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [docFile("drawing.dxf")] } });

    await waitFor(() => expect(uploadAuxFile).toHaveBeenCalledWith("m1", expect.any(File)));
    await screen.findByText("drawing.dxf");
  });

  it("shows an inline error and leaves the list untouched when the upload fails", async () => {
    vi.mocked(uploadAuxFile).mockRejectedValue(new AuxFileError("FILE_TOO_LARGE"));
    const model = editableModel();
    const { container } = render(<AddModelFlow overlay={fakeOverlay()} mode="edit" model={model} onClose={() => {}} />);

    const input = container.querySelector('[data-testid="auxFileInput"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [docFile()] } });

    await screen.findByText("Файл больше 100 МБ, уменьшите файл.");
    expect(screen.queryByText("manual.pdf")).toBeNull();
  });

  it("deletes an aux file after clicking remove", async () => {
    vi.mocked(deleteAuxFile).mockResolvedValue(true);
    const model = editableModel({
      auxFiles: [{ id: "f1", role: "aux", original_filename: "manual.pdf", mime_type: "application/pdf", size_bytes: 2048 }],
    });
    render(<AddModelFlow overlay={fakeOverlay()} mode="edit" model={model} onClose={() => {}} />);

    fireEvent.click(screen.getByLabelText("Удалить manual.pdf"));

    await waitFor(() => expect(deleteAuxFile).toHaveBeenCalledWith("m1", "f1"));
    await waitFor(() => expect(screen.queryByText("manual.pdf")).toBeNull());
  });
});
