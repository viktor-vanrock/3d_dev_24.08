import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { GetProjectManifestResult, PutProjectManifestRequest } from "@portal/contracts/http/models";
import type { PutProjectManifestOutcome } from "./models.ts";
import { ProjectManifestEditor } from "./projectmanifest.tsx";

const manifestResult = ({
  contract_version: "project-code.v1",
  head_sha: "head-before",
  manifest_digest: "digest-before",
  configuration_digest: null,
  diagnostics: [],
  manifest: {
    schema: "https://schemas.3mf.tech/project/v1",
    project: {
      uid: "robot",
      title: "Робот",
      "default-configuration": "default",
      units: { length: "mm", coordinates: "right-handed-z-up" },
      "x-project-note": { keep: true },
    },
    artifacts: {},
    components: {},
    configurations: { default: { title: "Основная", artifacts: [], components: [], workflow: "build", "x-material": "PLA" } },
    connections: {},
    workflows: {},
    "x-slicer-profile": { layer_height_mm: 0.2 },
  },
} as unknown) as GetProjectManifestResult;

type SaveManifest = (modelId: string, request: PutProjectManifestRequest) => Promise<PutProjectManifestOutcome>;

afterEach(cleanup);

describe("ProjectManifestEditor", () => {
  it("сохраняет неизвестные x-* поля и исходную версию при правке известного имени", async () => {
    const user = userEvent.setup();
    const save = vi.fn<SaveManifest>(async () => ({
      ok: true,
      value: { contract_version: "project-code.v1", head_sha: "head-after", manifest_digest: "digest-after", configuration_digest: null, diagnostics: [] },
    }));
    render(<ProjectManifestEditor modelId="m1" load={async () => manifestResult} save={save} onClose={() => {}} />);

    const name = await screen.findByRole("textbox", { name: "Название проекта" });
    await user.clear(name);
    await user.type(name, "Манипулятор");
    await user.click(screen.getByRole("button", { name: "Сохранить проект" }));

    expect((await screen.findByRole("status")).textContent).toContain("Изменения сохранены");
    const request = save.mock.calls[0]![1];
    expect(request.base_head_sha).toBe("head-before");
    expect(request.manifest.project.title).toBe("Манипулятор");
    expect(request.manifest["x-slicer-profile"]).toEqual({ layer_height_mm: 0.2 });
    expect((request.manifest.project as unknown as Record<string, unknown>)["x-project-note"]).toEqual({ keep: true });
    expect((request.manifest.configurations!.default as unknown as Record<string, unknown>)["x-material"]).toBe("PLA");
  });

  it("не затирает форму и явно предлагает перечитать проект при конфликте изменений", async () => {
    const user = userEvent.setup();
    const save = vi.fn<SaveManifest>(async () => ({ ok: false, conflict: true, currentHeadSha: "head-new" }));
    const load = vi.fn(async () => manifestResult);
    render(<ProjectManifestEditor modelId="m1" load={load} save={save} onClose={() => {}} />);

    const name = await screen.findByRole("textbox", { name: "Название проекта" });
    await user.clear(name);
    await user.type(name, "Моя несохранённая правка");
    await user.click(screen.getByRole("button", { name: "Сохранить проект" }));

    expect((await screen.findByRole("alert")).textContent).toContain("Кто-то изменил проект");
    expect((screen.getByRole("textbox", { name: "Название проекта" }) as HTMLInputElement).value).toBe("Моя несохранённая правка");
    expect((screen.getByRole("button", { name: "Перечитать актуальную версию" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("показывает понятную ошибку недоступного редактора", async () => {
    render(<ProjectManifestEditor modelId="m1" load={async () => null} save={vi.fn()} onClose={() => {}} />);
    expect((await screen.findByRole("alert")).textContent).toContain("Не удалось загрузить настройки проекта");
  });
});
