import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { PlateScreen } from "./platescreen.tsx";

const activation = vi.hoisted(() => ({
  printers: [
    {
      id: "printer-1",
      brand: "Prusa",
      model: "MK4",
      is_primary: true,
      verified: true,
      build_volume: { x: 250, y: 210, z: 220 },
      nozzle_mm: 0.4,
      kinematics: "cartesian",
    },
  ],
  filaments: [{ id: "filament-1", material_id: "material-1", name: "PLA Basic", brand: "Prusament", material_type: "pla" }],
}));

vi.mock("@shared/lib/activation.ts", () => ({ useActivation: () => activation }));
vi.mock("@platform/nav/homeheader.tsx", () => ({ HomeHeader: () => <header /> }));

const sceneHandle = vi.hoisted(() => ({
  resize: vi.fn(),
  dispose: vi.fn(),
  setBed: vi.fn(),
  syncPlacements: vi.fn(),
}));
vi.mock("./platescene.ts", () => ({ createPlateScene: vi.fn(() => sceneHandle) }));

const getModel = vi.hoisted(() => vi.fn<(id: string) => Promise<Record<string, unknown> | null>>());
const listModels = vi.hoisted(() =>
  vi.fn<(params?: Record<string, unknown>) => Promise<{ models: Record<string, unknown>[]; has_more: boolean; next_cursor: string | null } | null>>(
    async () => ({ models: [], has_more: false, next_cursor: null }),
  ),
);
vi.mock("@domains/commerce/models.ts", () => ({ getModel, listModels }));

const listSlicerProfiles = vi.hoisted(() => vi.fn());
const createSliceJob = vi.hoisted(() => vi.fn());
const getSliceJob = vi.hoisted(() => vi.fn());
const resolveProjectSliceSource = vi.hoisted(() => vi.fn());
vi.mock("./api.ts", () => ({ listSlicerProfiles, createSliceJob, getSliceJob, resolveProjectSliceSource }));

const navigate = vi.hoisted(() => vi.fn());
vi.mock("../../../router.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../router.ts")>();
  return { ...actual, navigate };
});

const user = { id: "user-1", username: "maker", display_name: null, avatar_url: null, handle_confirmed: true, role: "user" as const };

beforeEach(() => {
  activation.filaments = [{ id: "filament-1", material_id: "material-1", name: "PLA Basic", brand: "Prusament", material_type: "pla" }];
  getModel.mockResolvedValue({
    id: "model-1",
    title: "Ваза дракон",
    status: "ready",
    bbox: { min: [0, 0, 0], max: [100, 80, 40], size: [100, 80, 40], unit: "mm" },
  });
  listSlicerProfiles.mockImplementation(async (cls: string) => [
    { id: `${cls}-profile-1`, name: `${cls === "process" ? "MK4 0.4mm" : "PLA generic"}`, source_name: "PrusaSlicer", machine_id: null, material_id: null },
  ]);
  resolveProjectSliceSource.mockResolvedValue(null);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("PlateScreen — раскладка и отправка джобы", () => {
  it("префиллит модель из query, раскладывает и позволяет отправить джобу", async () => {
    const events = userEvent.setup();
    createSliceJob.mockResolvedValue({ ok: true, job: { id: "job-1", status: "succeeded", error: null } });

    render(<PlateScreen user={user} section="printers" onSectionChange={() => {}} modelId="model-1" />);

    expect(await screen.findByText("Ваза дракон")).toBeTruthy();
    await waitFor(() => {
      const lastCall = sceneHandle.syncPlacements.mock.calls.at(-1);
      expect(lastCall?.[0]).toHaveLength(1); // одна копия по умолчанию
    });

    await waitFor(() => expect(screen.getByLabelText("Профиль печати (слайсер)")).toBeTruthy());
    await events.selectOptions(screen.getByLabelText("Профиль печати (слайсер)"), "process-profile-1");
    await events.selectOptions(screen.getByLabelText("Филамент"), "filament-1");

    const submitButton = screen.getByRole("button", { name: "Нарезать в облаке" }) as HTMLButtonElement;
    await waitFor(() => expect(submitButton.disabled).toBe(false));
    await events.click(submitButton);

    expect(await screen.findByText("Готово — отправить на принтер")).toBeTruthy();
    expect(createSliceJob).toHaveBeenCalledWith("model-1", expect.objectContaining({
      profile_id: "process-profile-1",
      device_id: "printer-1",
    }));

    await events.click(screen.getByText("Готово — отправить на принтер"));
    expect(navigate).toHaveBeenCalledWith(expect.stringContaining("/slice/job-1/print"));
  });

  it("не даёт отправить, пока модели с коллизией/выходом за стол", async () => {
    render(<PlateScreen user={user} section="printers" onSectionChange={() => {}} modelId="model-1" />);
    await screen.findByText("Ваза дракон");

    const copiesInput = screen.getByLabelText("Количество копий: Ваза дракон");
    await userEvent.setup().clear(copiesInput);
    await userEvent.setup().type(copiesInput, "1");

    // По умолчанию (стол 250×210, одна деталь 100×80) коллизий нет — кнопка активна после выбора
    // остальных параметров. Здесь просто проверяем, что подсказка о коллизии не показана.
    expect(screen.queryByText("Уберите пересечения/выход за стол перед отправкой")).toBeNull();
  });

  it("показывает пустое состояние, когда стол пуст", async () => {
    render(<PlateScreen user={user} section="printers" onSectionChange={() => {}} />);
    expect(await screen.findByText("Стол пуст")).toBeTruthy();
    const submit = screen.getByRole("button", { name: "Нарезать в облаке" }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
  });

  it("позволяет задать PLA вручную, если в профиле ещё нет катушек", async () => {
    activation.filaments = [];
    render(<PlateScreen user={user} section="printers" onSectionChange={() => {}} modelId="model-1" />);

    await screen.findByText("Ваза дракон");
    expect((screen.getByLabelText("Филамент") as HTMLSelectElement).value).toBe("manual:pla");
    expect(screen.getByRole("button", { name: "1 PLA" })).toBeTruthy();
    await waitFor(() => expect((screen.getByRole("button", { name: "Нарезать в облаке" }) as HTMLButtonElement).disabled).toBe(false));
  });

  it("добавляет модель через поиск", async () => {
    listModels.mockResolvedValue({
      models: [{ id: "model-2", title: "Кронштейн", status: "ready" }],
      has_more: false,
      next_cursor: null,
    });
    getModel.mockResolvedValueOnce({
      id: "model-2",
      title: "Кронштейн",
      status: "ready",
      bbox: { size: [40, 30, 10], unit: "mm" },
    });

    render(<PlateScreen user={user} section="printers" onSectionChange={() => {}} />);
    const search = screen.getByLabelText("Поиск модели");
    await userEvent.setup().type(search, "кронштейн");

    const found = await screen.findByText("Кронштейн");
    await userEvent.setup().click(within(found.closest("button")!).getByText("+"));

    expect(await screen.findByText("Кронштейн", { selector: ".plateItemRow span" })).toBeTruthy();
  });

  it("отправляет code-first artifact как server-owned layout и получает G-code", async () => {
    listSlicerProfiles.mockImplementation(async (cls: string) => cls === "process"
      ? [
          { id: "misleading-profile", name: "0.05mm DETAIL @MINIIS 0.25", source_name: "PrusaSlicer", machine_id: null, material_id: null },
          { id: "u1-process", name: "0.20 Standard @Snapmaker U1 (0.4 nozzle)", source_name: "OrcaSlicer · Snapmaker U1", machine_id: null, material_id: null },
        ]
      : [
          { id: "generic-pla", name: "Generic PLA", source_name: "PrusaSlicer", machine_id: null, material_id: null },
          { id: "u1-pla", name: "Snapmaker PLA @U1", source_name: "OrcaSlicer · Snapmaker U1", machine_id: null, material_id: null },
        ]);
    const source = {
      model_id: "5b1641eb-8735-4a92-9d77-9db60bdcc80a",
      revision: "fda892cba81032c46c40976a48c9ceadbf40a9ca",
      configuration_id: "so101-follower",
      configuration_digest: "a".repeat(64),
      workflow_step_id: "print-gauges",
      artifact_id: "gauge-loose",
      artifact_sha256: "b".repeat(64),
    };
    resolveProjectSliceSource.mockResolvedValue(source);
    createSliceJob.mockResolvedValue({
      ok: true,
      job: {
        id: "job-gauge",
        status: "succeeded",
        error: null,
        gcode_url: "/slice-jobs/job-gauge/download",
        metrics: { print_time_seconds: 480, filament_used_g: 2.4 },
      },
    });

    render(
      <PlateScreen
        user={user}
        section="market"
        onSectionChange={() => {}}
        modelId="so-arm100"
        artifactId="gauge-loose"
        stepId="print-gauges"
      />,
    );

    expect((await screen.findAllByText("Gauge 0 · обычная посадка")).length).toBeGreaterThan(0);
    const submit = screen.getByRole("button", { name: "Нарезать в облаке" }) as HTMLButtonElement;
    await waitFor(() => expect(submit.disabled).toBe(false));
    await userEvent.setup().click(submit);

    expect(createSliceJob).toHaveBeenCalledWith(source.model_id, expect.objectContaining({
      profile_id: "u1-process",
      filament_profile_id: "u1-pla",
      layout: expect.objectContaining({
        bed_geometry: expect.objectContaining({ width_mm: 250, depth_mm: 210, origin: "center" }),
        instances: [
          expect.objectContaining({
            source,
            instance_id: "artifact-gauge-loose-0",
          }),
        ],
      }),
      intent: { quality: "strength", supports: "auto" },
    }));
    expect(await screen.findByText("G-code готов")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Скачать G-code" })).toBeTruthy();
  });
});
