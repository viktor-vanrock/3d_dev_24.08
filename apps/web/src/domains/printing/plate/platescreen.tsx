import { useEffect, useMemo, useRef, useState } from "react";
import type { SessionUser } from "@shared/types";
import { useActivation } from "@shared/lib";
import { HomeHeader, type Section } from "@platform/nav";
// eslint-disable-next-line boundaries/element-types -- легатное междоменное ребро (Этап 8): plate→commerce runtime API моделей (getModel/listModels/modelBboxSizeMm/soarmFollowerBuildGuide + MarketModel). Слайсинг работает поверх каталога моделей; развязка отложена до pages/DI. См. MIGRATION.md.
import { modelBboxSizeMm, getModel, listModels, triggerBrowserDownload, type MarketModel, soarmFollowerBuildGuide } from "@domains/commerce";
import { apiAssetUrl } from "@shared/api";
import { navigate, parkAddPath, parkPath, slicePrintPath } from "../../../router.ts";
import { SegmentToggle, Button, StatusPill } from "@shared/ui";
import {
  createSliceJob,
  getSliceJob,
  listSlicerProfiles,
  resolveProjectSliceSource,
  type SlicerProfileOption,
  type SliceJobStatus,
} from "./api.ts";
import { autoArrange, computeStatuses, type BedSize, type Placement } from "./bedlayout.ts";
import "./plate.css";
import { createPlateScene, type PlateAssetSource, type PlateSceneHandle } from "./platescene.ts";
import { buildSliceRequestPayload } from "./slicetrust.ts";

/*
  Полноэкранный слайсер (MF-1094): 3D-сцена — сама рабочая поверхность, а не карточка в
  документе. Настройки плавают справа и делятся на «Обычный» (намерение, материал, supports)
  и «Про» (реальные профили Orca и геометрия). Конкретный artifact из code-first инструкции
  всегда грузится из pinned release и никогда не заменяется верхнеуровневым preview проекта.
*/

interface PlateItem {
  assetKey: string;
  sliceModelId: string;
  title: string;
  source: PlateAssetSource | null;
  footprint: { width: number; depth: number };
  copies: number;
  artifact: boolean;
}

interface ModelJobState {
  status: SliceJobStatus | "idle";
  jobId: string | null;
  error: string | null;
  gcodeUrl: string | null;
  metrics: Record<string, unknown> | null;
}

type WorkspaceMode = "simple" | "pro";
type QualityIntent = "draft" | "standard" | "fine";
type SupportIntent = "auto" | "tree" | "off";
type ArtifactSourceState = "idle" | "loading" | "ready" | "failed";

const POLL_INTERVAL_MS = 2000;
const DEFAULT_BED: BedSize = { width: 220, depth: 220 };
const U1_BED: BedSize = { width: 270, depth: 270 };
const MAX_COPIES = 50;
const MANUAL_PLA_VALUE = "manual:pla";

function instanceId(assetKey: string, index: number): string {
  return `${assetKey}#${index}`;
}

function expandItems(items: PlateItem[]): { id: string; modelId: string; footprint: { width: number; depth: number } }[] {
  return items.flatMap((item) =>
    Array.from({ length: item.copies }, (_, index) => ({
      id: instanceId(item.assetKey, index),
      modelId: item.assetKey,
      footprint: item.footprint,
    })),
  );
}

function projectArtifact(modelId: string | undefined, artifactId: string | undefined) {
  if (!modelId || !artifactId || modelId !== "so-arm100") return null;
  for (const step of soarmFollowerBuildGuide().steps) {
    const artifact = step.artifacts?.find((candidate) => candidate.id === artifactId);
    if (artifact) return artifact;
  }
  return null;
}

const JOB_ERROR_LABEL: Record<string, string> = {
  model_not_ready: "Модель ещё конвертируется",
  not_found: "Модель или устройство не найдены",
  filament_profile_not_found: "Профиль материала не найден",
  SLICE_TRUST_INVALID: "Не удалось проверить параметры слайсинга",
  SLICE_TRUST_VERSION_UNSUPPORTED: "Обновите страницу: контракт изменился",
  SLICE_TRUST_CONFLICT: "Такая джоба уже создана с другими параметрами",
  SLICE_TRUST_SIGNATURE_INVALID: "Сервис подписи G-code временно недоступен",
  request_failed: "Сервер не принял джобу",
  network_error: "Нет связи с сервером",
  SOURCE_NOT_FOUND: "Закреплённый файл проекта не найден",
  SOURCE_ARTIFACT_MISMATCH: "Файл проекта изменился — обновите страницу",
  SOURCE_ROLE_UNSUPPORTED: "Этот тип файла пока нельзя нарезать",
  SOURCE_MODEL_MISMATCH: "Источник не принадлежит выбранному проекту",
  BED_GEOMETRY_UNCONFIRMED: "Подтвердите размеры стола принтера",
  LAYOUT_INVALID: "Раскладка стола некорректна",
  LAYOUT_PREFLIGHT_FAILED: "Проверьте пересечения и границы стола",
  UNSUPPORTED_TOOLHEAD: "Эта конфигурация печатающей головы пока не поддерживается",
};

function jobErrorLabel(code: string | null): string {
  if (!code) return "Слайсинг не удался";
  return JOB_ERROR_LABEL[code] ?? code;
}

function formatMillimetres(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

export function PlateScreen({
  user,
  section,
  onSectionChange,
  modelId,
  artifactId,
  stepId,
}: {
  user: SessionUser;
  section: Section;
  onSectionChange: (section: Section) => void;
  modelId?: string;
  artifactId?: string;
  stepId?: string;
}) {
  const { printers, filaments } = useActivation();
  const artifact = useMemo(() => projectArtifact(modelId, artifactId), [modelId, artifactId]);
  const [mode, setMode] = useState<WorkspaceMode>("simple");
  const [quality, setQuality] = useState<QualityIntent>("standard");
  const [supportsIntent, setSupportsIntent] = useState<SupportIntent>("auto");
  const [showSupports, setShowSupports] = useState(true);
  const [inspectorOpen, setInspectorOpen] = useState(true);

  const [printerId, setPrinterId] = useState<string | null>(null);
  const [filamentId, setFilamentId] = useState<string | null>(null);
  const [processProfiles, setProcessProfiles] = useState<SlicerProfileOption[]>([]);
  const [filamentProfiles, setFilamentProfiles] = useState<SlicerProfileOption[]>([]);
  const [processProfileId, setProcessProfileId] = useState<string | null>(null);
  const [filamentProfileId, setFilamentProfileId] = useState<string | null>(null);

  const [items, setItems] = useState<PlateItem[]>([]);
  const [placements, setPlacements] = useState<Placement[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [searchResults, setSearchResults] = useState<MarketModel[]>([]);
  const [addError, setAddError] = useState<string | null>(null);
  const [assetStates, setAssetStates] = useState<Record<string, "loading" | "ready" | "failed">>({});

  const [jobs, setJobs] = useState<Record<string, ModelJobState>>({});
  const [submitting, setSubmitting] = useState(false);
  const [artifactSliceSource, setArtifactSliceSource] = useState<Awaited<ReturnType<typeof resolveProjectSliceSource>>>(null);
  const [artifactSourceState, setArtifactSourceState] = useState<ArtifactSourceState>("idle");

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const sceneRef = useRef<PlateSceneHandle | null>(null);
  const addedAssetKeys = useRef(new Set<string>());

  const printer = printers.find((candidate) => candidate.id === printerId) ?? null;
  const selectedFilament = filaments.find((candidate) => candidate.id === filamentId) ?? null;
  const isSnapmaker = printer ? /snapmaker/i.test(`${printer.brand} ${printer.model}`) && /\bu1\b/i.test(printer.model) : false;
  const isPrinterOnline = Boolean(printer?.verified && (printer.link_source === "connector" || printer.lan_endpoint));
  const buildVolumeX = printer?.build_volume?.x;
  const buildVolumeY = printer?.build_volume?.y;
  const bed: BedSize = useMemo(() => {
    if (buildVolumeX && buildVolumeY) return { width: buildVolumeX, depth: buildVolumeY };
    if (isSnapmaker || (artifact && !printer)) return U1_BED;
    return DEFAULT_BED;
  }, [artifact, buildVolumeX, buildVolumeY, isSnapmaker, printer]);

  const statuses = useMemo(() => computeStatuses(placements, bed), [placements, bed]);
  const statusById = useMemo(() => new Map(statuses.map((status) => [status.id, status])), [statuses]);
  const selectedPlacement = placements.find((placement) => placement.id === selectedId) ?? null;

  useEffect(() => {
    void listSlicerProfiles("process").then((list) => setProcessProfiles(list ?? []));
    void listSlicerProfiles("filament").then((list) => setFilamentProfiles(list ?? []));
  }, []);

  useEffect(() => {
    if (printerId || printers.length === 0) return;
    const u1 = printers.find((candidate) => /snapmaker/i.test(candidate.brand) && /\bu1\b/i.test(candidate.model));
    setPrinterId(u1?.id ?? printers.find((candidate) => candidate.is_primary)?.id ?? printers[0]!.id);
  }, [printerId, printers]);

  useEffect(() => {
    if (filamentId || filaments.length === 0) return;
    setFilamentId(filaments[0]!.id);
  }, [filamentId, filaments]);

  useEffect(() => {
    setProcessProfileId(null);
  }, [printerId, quality]);

  useEffect(() => {
    setFilamentProfileId(null);
  }, [filamentId]);

  useEffect(() => {
    if (processProfileId || processProfiles.length === 0) return;
    const machineProfile = processProfiles.find((profile) => (
      Boolean(printer?.printer_id) && profile.machine_id === printer?.printer_id
    ));
    const projectProfile = artifact
      ? processProfiles.find((profile) => /snapmaker.*\bu1\b|\bu1\b.*snapmaker/i.test(`${profile.name} ${profile.source_name}`))
      : undefined;
    const qualityProfile = processProfiles.find((profile) => (
      isSnapmaker
        ? /snapmaker|u1/i.test(`${profile.name} ${profile.source_name}`)
        : quality === "fine"
          ? /\bfine\b|\b0[.,](?:10|12)\b/i.test(profile.name)
          : /\bstandard\b|\b0[.,]20\b/i.test(profile.name)
    ));
    setProcessProfileId(machineProfile?.id ?? projectProfile?.id ?? qualityProfile?.id ?? processProfiles[0]!.id);
  }, [artifact, isSnapmaker, printer?.printer_id, processProfileId, processProfiles, quality]);

  useEffect(() => {
    if (filamentProfileId || filamentProfiles.length === 0) return;
    const projectPla = artifact
      ? filamentProfiles.find((profile) => (
        /\bPLA\b/i.test(`${profile.name} ${profile.source_name}`)
        && /snapmaker|\bu1\b/i.test(`${profile.name} ${profile.source_name}`)
      ))
      : undefined;
    const pla = filamentProfiles.find((profile) => (
      Boolean(selectedFilament?.material_id) && profile.material_id === selectedFilament?.material_id
    )) ?? filamentProfiles.find((profile) => /\bPLA\b/i.test(`${profile.name} ${profile.source_name}`));
    setFilamentProfileId(projectPla?.id ?? pla?.id ?? filamentProfiles[0]!.id);
  }, [artifact, filamentProfileId, filamentProfiles, selectedFilament?.material_id]);

  function addArtifact() {
    if (!artifact || !modelId || addedAssetKeys.current.has(`artifact:${artifact.id}`)) return;
    const assetKey = `artifact:${artifact.id}`;
    addedAssetKeys.current.add(assetKey);
    setItems((current) => [
      ...current,
      {
        assetKey,
        sliceModelId: modelId,
        title: artifact.label,
        source: { modelId: assetKey, url: artifact.url, format: artifact.format === "gltf" ? "gltf" : "stl" },
        // После STLLoader сцена пришлёт точный footprint. До этого нужна только безопасная
        // площадь для первого кадра и авто-раскладки.
        footprint: { width: 36, depth: 30 },
        copies: 1,
        artifact: true,
      },
    ]);
  }

  async function addModel(id: string) {
    if (addedAssetKeys.current.has(id)) return;
    setAddError(null);
    const detail = await getModel(id);
    if (!detail) {
      setAddError("Модель не найдена");
      return;
    }
    if (detail.status !== "ready") {
      setAddError("Модель ещё не готова к слайсингу");
      return;
    }
    const size = modelBboxSizeMm(detail.bbox);
    if (!size) {
      setAddError("У модели нет обмеров — слайсинг недоступен");
      return;
    }
    addedAssetKeys.current.add(id);
    setItems((current) => [
      ...current,
      {
        assetKey: id,
        sliceModelId: id,
        title: detail.title,
        source: detail.preview_url
          ? {
              modelId: id,
              url: apiAssetUrl(detail.preview_url),
              format: "gltf",
              dimensionsMm: { width: size.x, depth: size.y, height: size.z },
            }
          : null,
        footprint: { width: size.x, depth: size.y },
        copies: 1,
        artifact: false,
      },
    ]);
  }

  useEffect(() => {
    if (artifact) addArtifact();
    else if (modelId) void addModel(modelId);
    // Идентичность query-параметров достаточна; функции намеренно не мемоизируются, чтобы
    // не делать их частью публичного контракта компонента.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [artifact?.id, modelId]);

  useEffect(() => {
    let cancelled = false;
    if (!artifact || !modelId || !artifactId || !stepId) {
      setArtifactSliceSource(null);
      setArtifactSourceState("idle");
      return () => {
        cancelled = true;
      };
    }
    setArtifactSliceSource(null);
    setArtifactSourceState("loading");
    void resolveProjectSliceSource({
      projectUid: modelId,
      artifactId,
      artifactPath: artifact.url,
      workflowStepId: stepId,
    }).then((source) => {
      if (cancelled) return;
      setArtifactSliceSource(source);
      setArtifactSourceState(source ? "ready" : "failed");
    });
    return () => {
      cancelled = true;
    };
  }, [artifact, artifactId, modelId, stepId]);

  function removeItem(assetKey: string) {
    addedAssetKeys.current.delete(assetKey);
    setItems((current) => current.filter((item) => item.assetKey !== assetKey));
    setPlacements((current) => current.filter((placement) => placement.modelId !== assetKey));
  }

  function setCopies(assetKey: string, copies: number) {
    const clamped = Math.max(1, Math.min(MAX_COPIES, Math.round(copies) || 1));
    setItems((current) => current.map((item) => (item.assetKey === assetKey ? { ...item, copies: clamped } : item)));
  }

  function runAutoArrange(nextItems: PlateItem[] = items) {
    const { placements: next, overflowIds } = autoArrange(bed, expandItems(nextItems));
    setPlacements(next);
    setAddError(overflowIds.length > 0 ? `${overflowIds.length} шт. не поместилось на стол` : null);
  }

  useEffect(() => {
    if (items.length > 0) runAutoArrange(items);
    else setPlacements([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, bed.width, bed.depth]);

  useEffect(() => {
    if (!canvasRef.current) return;
    const handle = createPlateScene(canvasRef.current, bed, {
      onSelect: setSelectedId,
      onMove: (id, xMm, yMm) => {
        setPlacements((current) => current.map((placement) => (
          placement.id === id ? { ...placement, x: xMm, y: yMm } : placement
        )));
      },
      onAssetMeasured: (assetKey, measured) => {
        setItems((current) => current.map((item) => (
          item.assetKey === assetKey && (
            Math.abs(item.footprint.width - measured.width) > 0.5
            || Math.abs(item.footprint.depth - measured.depth) > 0.5
          )
            ? { ...item, footprint: { width: measured.width, depth: measured.depth } }
            : item
        )));
      },
      onAssetState: (assetKey, state) => {
        setAssetStates((current) => ({ ...current, [assetKey]: state }));
      },
    });
    sceneRef.current = handle;
    const observer = new ResizeObserver(() => handle.resize());
    observer.observe(canvasRef.current);
    return () => {
      observer.disconnect();
      handle.dispose();
      sceneRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    sceneRef.current?.setBed(bed);
  }, [bed]);

  useEffect(() => {
    sceneRef.current?.syncAssets?.(items.flatMap((item) => (item.source ? [item.source] : [])));
  }, [items]);

  useEffect(() => {
    sceneRef.current?.syncPlacements(placements, statusById, selectedId);
  }, [placements, selectedId, statusById]);

  useEffect(() => {
    sceneRef.current?.setSupportsVisible?.(showSupports && supportsIntent !== "off");
  }, [showSupports, supportsIntent]);

  function rotateSelected() {
    if (!selectedId) return;
    setPlacements((current) => current.map((placement) => (
      placement.id === selectedId ? { ...placement, rotationDeg: (placement.rotationDeg + 90) % 360 } : placement
    )));
  }

  useEffect(() => {
    let cancelled = false;
    void listModels({ owner: user.username, q: search || undefined, limit: 8 }).then((result) => {
      if (cancelled || !result) return;
      setSearchResults(result.models.filter((model) => model.status === "ready"));
    });
    return () => {
      cancelled = true;
    };
  }, [search, user.username]);

  function pollJob(assetKey: string, jobId: string) {
    const tick = async () => {
      const job = await getSliceJob(jobId);
      if (!job) return;
      setJobs((current) => ({
        ...current,
        [assetKey]: {
          status: job.status,
          jobId,
          error: job.error_code ?? job.error,
          gcodeUrl: job.gcode_url ?? null,
          metrics: job.metrics ?? null,
        },
      }));
      if (job.status === "queued" || job.status === "running") window.setTimeout(() => void tick(), POLL_INTERVAL_MS);
    };
    void tick();
  }

  const hasBlockingIssues = statuses.some((status) => status.collides || status.outOfBounds);
  const hasCodeFirstArtifact = items.some((item) => item.artifact);
  const artifactSourceReady = !hasCodeFirstArtifact || Boolean(artifactSliceSource);
  const canSubmit = Boolean(
    printer
      && processProfileId
      && filamentProfileId
      && items.length > 0
      && !hasBlockingIssues
      && !submitting
      && artifactSourceReady,
  );

  async function submit() {
    if (!printer || !processProfileId || !artifactSourceReady) return;
    setSubmitting(true);
    for (const item of items) {
      setJobs((current) => ({
        ...current,
        [item.assetKey]: { status: "queued", jobId: null, error: null, gcodeUrl: null, metrics: null },
      }));
      const source = item.artifact ? artifactSliceSource : null;
      const targetModelId = source?.model_id ?? item.sliceModelId;
      const trustPayload = await buildSliceRequestPayload({
        modelId: targetModelId,
        profileId: processProfileId,
        filamentProfileId,
        device: {
          id: printer.id,
          brand: printer.brand,
          model: printer.model,
          catalogPrinterId: printer.printer_id ?? null,
          nozzleMm: printer.nozzle_mm ?? null,
          kinematics: printer.kinematics ?? null,
          buildVolume: printer.build_volume ?? null,
        },
      });
      const payload = source ? {
        ...trustPayload,
        layout: {
          bed_geometry: {
            shape: "rect" as const,
            width_mm: bed.width,
            depth_mm: bed.depth,
            origin: "center" as const,
          },
          instances: placements
            .filter((placement) => placement.modelId === item.assetKey)
            .map((placement) => ({
              instance_id: placement.id.replace(/[^a-zA-Z0-9._-]/g, "-").slice(0, 128),
              source,
              x_mm: placement.x,
              y_mm: placement.y,
              rotation_z_deg: placement.rotationDeg,
              scale: 1,
            })),
          layout_snapshot_id: `plate-${item.assetKey}`
            .replace(/[^a-zA-Z0-9._-]/g, "-")
            .slice(0, 128),
        },
        intent: {
          quality: quality === "draft" ? "speed" as const : quality === "fine" ? "miniatures" as const : "strength" as const,
          supports: supportsIntent,
        },
      } : trustPayload;
      const result = await createSliceJob(targetModelId, payload);
      if (!result.ok) {
        setJobs((current) => ({
          ...current,
          [item.assetKey]: { status: "failed", jobId: null, error: result.error, gcodeUrl: null, metrics: null },
        }));
        continue;
      }
      setJobs((current) => ({
        ...current,
        [item.assetKey]: {
          status: result.job.status,
          jobId: result.job.id,
          error: null,
          gcodeUrl: result.job.gcode_url ?? null,
          metrics: result.job.metrics ?? null,
        },
      }));
      // POST идемпотентен и может сразу вернуть уже готовую джобу. Даже тогда нужен GET:
      // только он проходит dispatch-gate, верифицирует подпись и выдаёт короткоживущий gcode_url.
      if (
        result.job.status === "queued"
        || result.job.status === "running"
        || result.job.status === "succeeded"
      ) pollJob(item.assetKey, result.job.id);
    }
    setSubmitting(false);
  }

  function goBack() {
    if (window.history.length > 1) window.history.back();
    else navigate(parkPath());
  }

  const completedJob = Object.entries(jobs).find(([, job]) => job.status === "succeeded") ?? null;
  const usingManualPla = !selectedFilament;
  const totalCopies = items.reduce((sum, item) => sum + item.copies, 0);
  const assetLoading = items.some((item) => assetStates[item.assetKey] === "loading");

  return (
    <div className="home plateExperience">
      <HomeHeader
        user={user}
        printers={printers}
        section={section}
        onSectionChange={onSectionChange}
        onBack={goBack}
        backLabel="К проекту"
        mode="full"
      />

      <main className="plateWorkspace" aria-label="Слайсер">
        <section className="plateSceneLayer" aria-label="Трёхмерный стол принтера">
          <canvas ref={canvasRef} aria-label="Интерактивная 3D-сцена стола" />
          <div className="plateSceneGlow" aria-hidden="true" />
        </section>

        <section className="plateContextHud" aria-label="Текущий файл">
          <span className="plateEyebrow">{artifact ? "Шаг из code-first проекта" : "Подготовка к печати"}</span>
          <strong>{artifact?.label ?? (items.length > 0 ? "Рабочий стол" : "Новый стол")}</strong>
          <span>
            {artifactId ? `${artifactId} · ` : ""}
            {stepId ? `этап ${stepId}` : `${totalCopies || 0} объектов`}
          </span>
        </section>

        <div className="plateSceneStatus" role="status" aria-live="polite">
          <span className="plateLiveDot" data-online={isPrinterOnline || undefined} />
          {assetLoading ? "Загружаем STL…" : `${bed.width} × ${bed.depth} мм`}
          <span aria-hidden="true">·</span>
          {showSupports && supportsIntent !== "off" ? "supports · предварительно" : "без поддержек"}
        </div>

        <div className="plateSceneTools" role="toolbar" aria-label="Вид сцены">
          <button type="button" className="plateToolButton pressable" onClick={() => sceneRef.current?.setView?.("perspective")} aria-label="Перспектива">◈</button>
          <button type="button" className="plateToolButton pressable" onClick={() => sceneRef.current?.setView?.("top")} aria-label="Вид сверху">⊤</button>
          <button type="button" className="plateToolButton pressable" onClick={() => sceneRef.current?.setView?.("front")} aria-label="Вид спереди">▣</button>
          <button type="button" className="plateToolButton pressable" onClick={() => sceneRef.current?.resetView?.()} aria-label="Вернуть камеру">↺</button>
        </div>

        <section className="plateObjectDock" aria-label="Объекты на столе">
          <div className="plateDockHeader">
            <span>Объекты</span>
            <button type="button" className="pressable" onClick={() => setInspectorOpen(true)}>
              {totalCopies} на столе
            </button>
          </div>
          {items.length === 0 ? (
            <div className="plateEmptyObject">
              <strong>Стол пуст</strong>
              <span>Найдите модель и добавьте её</span>
            </div>
          ) : (
            <div className="plateDockItems">
              {items.map((item) => (
                <div
                  key={item.assetKey}
                  className="plateDockItem plateItemRow"
                  data-selected={selectedId?.startsWith(`${item.assetKey}#`) || undefined}
                >
                  <button
                    type="button"
                    className="plateDockSelect pressable"
                    onClick={() => setSelectedId(instanceId(item.assetKey, 0))}
                    aria-label={`Выбрать ${item.title}`}
                  >
                    <span className="plateDockThumb" data-state={assetStates[item.assetKey] ?? "idle"} aria-hidden="true">◇</span>
                    <span>
                      <span className="plateDockTitle">{item.title}</span>
                      <small>{item.artifact ? "STL из релиза" : "Модель"}</small>
                    </span>
                  </button>
                  <span className="plateDockActions">
                    <input
                      type="number"
                      min={1}
                      max={MAX_COPIES}
                      value={item.copies}
                      aria-label={`Количество копий: ${item.title}`}
                      onChange={(event) => setCopies(item.assetKey, Number(event.target.value))}
                    />
                    <button type="button" className="pressable" onClick={() => removeItem(item.assetKey)} aria-label={`Убрать ${item.title}`}>×</button>
                  </span>
                </div>
              ))}
            </div>
          )}
          <details className="plateAddObject">
            <summary>+ Добавить модель</summary>
            <label htmlFor="plate-model-search">Поиск модели</label>
            <input
              id="plate-model-search"
              placeholder="Найти свою модель…"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              aria-label="Поиск модели"
            />
            {searchResults.length > 0 ? (
              <div className="plateSearchResults">
                {searchResults.map((model) => (
                  <button key={model.id} type="button" className="plateSearchResultRow pressable" onClick={() => void addModel(model.id)}>
                    <span>{model.title}</span>
                    <span aria-hidden="true">+</span>
                  </button>
                ))}
              </div>
            ) : null}
          </details>
        </section>

        <button
          type="button"
          className="plateInspectorGrip pressable"
          aria-label={inspectorOpen ? "Скрыть настройки" : "Показать настройки"}
          aria-expanded={inspectorOpen}
          onClick={() => setInspectorOpen((value) => !value)}
        >
          {inspectorOpen ? "→" : "←"}
        </button>

        <aside className="plateInspector" data-open={inspectorOpen || undefined} aria-label="Настройки печати">
          <header className="plateInspectorHeader">
            <div>
              <span className="plateEyebrow">Подготовка печати</span>
              <h1>Слайсинг</h1>
            </div>
            <SegmentToggle<WorkspaceMode>
              className="plateModeTabs"
              ariaLabel="Режим настройки"
              value={mode}
              options={[
                { value: "simple", label: "Обычный" },
                { value: "pro", label: "Про" },
              ]}
              onChange={setMode}
            />
          </header>

          <div className="plateInspectorScroll">
            <section className="plateInspectorSection">
              <div className="plateSectionHeading">
                <span>01</span>
                <h2>Принтер</h2>
                <StatusPill tone={isPrinterOnline ? "ok" : "dim"}>
                  {isPrinterOnline ? "в сети" : printer ? "профиль" : "не выбран"}
                </StatusPill>
              </div>
              {printers.length > 0 ? (
                <label className="plateSelectField">
                  <span>Мой принтер</span>
                  <select id="plate-printer" value={printerId ?? ""} onChange={(event) => setPrinterId(event.target.value || null)}>
                    {printers.map((candidate) => (
                      <option key={candidate.id} value={candidate.id}>
                        {candidate.brand} {candidate.model}
                      </option>
                    ))}
                  </select>
                </label>
              ) : (
                <div className="plateInlineNotice">В парке пока нет принтера.</div>
              )}
              {printer ? (
                <div className="plateMachineFacts">
                  <span><b>{printer.build_volume?.x ?? "—"} × {printer.build_volume?.y ?? "—"} × {printer.build_volume?.z ?? "—"}</b> мм</span>
                  <span><b>{printer.nozzle_mm ?? 0.4}</b> мм сопло</span>
                  <span><b>{printer.verified ? "Проверен" : "Заявлен"}</b> профиль</span>
                </div>
              ) : null}
              {!isSnapmaker ? (
                <button
                  type="button"
                  className="plateConnectMachine pressable"
                  onClick={() => navigate(parkAddPath({
                    brand: "Snapmaker",
                    model: "U1",
                    returnTo: window.location.pathname + window.location.search,
                  }))}
                >
                  <span className="plateConnectIcon" aria-hidden="true">⌁</span>
                  <span>
                    <strong>Подключить Snapmaker U1</strong>
                    <small>Локальный помощник найдёт Moonraker в сети</small>
                  </span>
                  <span aria-hidden="true">→</span>
                </button>
              ) : (
                <div className="plateRelayRoute">
                  <span>Portal</span><i>→</i><span>local helper</span><i>→</i><span>U1</span>
                </div>
              )}
            </section>

            <section className="plateInspectorSection">
              <div className="plateSectionHeading">
                <span>02</span>
                <h2>Материал</h2>
                <small>{isPrinterOnline ? "синхронизация" : "вручную"}</small>
              </div>
              <div className="plateMaterialSlots" role="list" aria-label="Слоты материала">
                {[0, 1, 2, 3].map((slot) => {
                  const material = slot === 0 ? selectedFilament : null;
                  const manualMaterial = slot === 0 && usingManualPla;
                  return (
                    <button
                      key={slot}
                      type="button"
                      className="plateMaterialSlot pressable"
                      data-active={Boolean(material) || manualMaterial || undefined}
                      onClick={() => {
                        if (!material && filaments[slot]) setFilamentId(filaments[slot]!.id);
                      }}
                    >
                      <span style={{ "--spool-color": material?.color_hex ?? "#e8efe5" } as React.CSSProperties} />
                      <b>{slot + 1}</b>
                      <small>{material?.material_type?.toUpperCase() ?? (manualMaterial ? "PLA" : "+")}</small>
                    </button>
                  );
                })}
              </div>
              <label className="plateSelectField">
                <span>Филамент</span>
                <select
                  id="plate-filament"
                  value={filamentId ?? MANUAL_PLA_VALUE}
                  onChange={(event) => setFilamentId(event.target.value === MANUAL_PLA_VALUE ? null : event.target.value)}
                  aria-label="Филамент"
                >
                  <option value={MANUAL_PLA_VALUE}>PLA · задан вручную</option>
                  {filaments.map((filament) => (
                    <option key={filament.id} value={filament.id}>{filament.brand} {filament.name}</option>
                  ))}
                </select>
              </label>
            </section>

            <section className="plateInspectorSection">
              <div className="plateSectionHeading">
                <span>03</span>
                <h2>Как печатать</h2>
                <small>{quality === "draft" ? "быстро" : quality === "fine" ? "детально" : "баланс"}</small>
              </div>
              <div className="plateIntentGrid" role="radiogroup" aria-label="Качество">
                {([
                  ["draft", "Черновик", "0,28 мм"],
                  ["standard", "Стандарт", "0,20 мм"],
                  ["fine", "Точно", "0,12 мм"],
                ] as const).map(([value, label, sub]) => (
                  <button
                    key={value}
                    type="button"
                    role="radio"
                    aria-checked={quality === value}
                    className="plateIntent pressable"
                    data-selected={quality === value || undefined}
                    onClick={() => setQuality(value)}
                  >
                    <strong>{label}</strong>
                    <small>{sub}</small>
                  </button>
                ))}
              </div>

              <div className="plateSupportRow">
                <div>
                  <strong>Поддержки</strong>
                  <small>Зелёные опоры на сцене — предварительные. Финальные построит Orca.</small>
                </div>
                <select value={supportsIntent} onChange={(event) => setSupportsIntent(event.target.value as SupportIntent)} aria-label="Поддержки">
                  <option value="auto">Авто</option>
                  <option value="tree">Дерево</option>
                  <option value="off">Без них</option>
                </select>
              </div>
              <label className="plateSwitchRow">
                <span>
                  <strong>Показывать supports</strong>
                  <small>Предварительный слой</small>
                </span>
                <input type="checkbox" checked={showSupports} onChange={(event) => setShowSupports(event.target.checked)} />
              </label>
            </section>

            {mode === "pro" ? (
              <section className="plateInspectorSection plateProSection">
                <div className="plateSectionHeading">
                  <span>04</span>
                  <h2>Профили Orca</h2>
                  <StatusPill tone="dim">pro</StatusPill>
                </div>
                <label className="plateSelectField">
                  <span>Профиль печати (слайсер)</span>
                  <select
                    id="plate-process-profile"
                    value={processProfileId ?? ""}
                    onChange={(event) => setProcessProfileId(event.target.value || null)}
                    aria-label="Профиль печати (слайсер)"
                  >
                    <option value="">— выберите профиль —</option>
                    {processProfiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}
                  </select>
                </label>
                <label className="plateSelectField">
                  <span>Профиль филамента (слайсер)</span>
                  <select
                    id="plate-filament-profile"
                    value={filamentProfileId ?? ""}
                    onChange={(event) => setFilamentProfileId(event.target.value || null)}
                    aria-label="Профиль филамента (слайсер)"
                  >
                    <option value="">— без профиля —</option>
                    {filamentProfiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}
                  </select>
                </label>
                <div className="plateTransformGrid">
                  <button type="button" className="pressable" onClick={() => runAutoArrange()} disabled={items.length === 0}>Авто‑раскладка</button>
                  <button type="button" className="pressable" onClick={rotateSelected} disabled={!selectedId}>Повернуть 90°</button>
                </div>
                {selectedPlacement ? (
                  <div className="plateCoordinates">
                    <span>X <b>{formatMillimetres(selectedPlacement.x)}</b></span>
                    <span>Y <b>{formatMillimetres(selectedPlacement.y)}</b></span>
                    <span>R <b>{selectedPlacement.rotationDeg}°</b></span>
                  </div>
                ) : null}
              </section>
            ) : (
              // Сохраняем label в DOM и простую доступность автотеста, хотя в обычном режиме
              // человек не обязан разбираться в именах Orca-профилей.
              <label className="plateVisuallyHidden">
                Профиль печати (слайсер)
                <select
                  value={processProfileId ?? ""}
                  onChange={(event) => setProcessProfileId(event.target.value || null)}
                  aria-label="Профиль печати (слайсер)"
                >
                  <option value="">— выберите профиль —</option>
                  {processProfiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}
                </select>
              </label>
            )}

            {addError ? <div className="plateInlineNotice" role="status">{addError}</div> : null}
            {artifactSourceState === "failed" ? (
              <div className="plateInlineNotice" role="status">
                Не удалось подтвердить закреплённый файл проекта. Обновите страницу после публикации ревизии.
              </div>
            ) : null}
            {hasBlockingIssues ? <div className="plateInlineNotice" role="status">Уберите пересечения или выход за край стола.</div> : null}
          </div>

          <footer className="plateInspectorFooter">
            <div className="plateSliceEstimate">
              <span>
                <small>Оценка</small>
                <strong>после слайсинга</strong>
              </span>
              <span>
                <small>Материал</small>
                <strong>посчитает Orca</strong>
              </span>
            </div>
            <Button onClick={() => void submit()} disabled={!canSubmit} loading={submitting}>
              {artifactSourceState === "loading" ? "Проверяем файл проекта…" : "Нарезать в облаке"}
            </Button>
            <span className="plateFooterTrust">
              Результат — готовый G-code. Скачать или отправить на принтер можно после проверки.
            </span>
          </footer>

          {completedJob ? (
            <JobOutcome
              item={items.find((item) => item.assetKey === completedJob[0])}
              job={completedJob[1]}
              printerId={printerId}
            />
          ) : null}
          {Object.entries(jobs).map(([assetKey, job]) => (
            job.status === "queued" || job.status === "running" || job.status === "failed"
              ? <JobProgress key={assetKey} job={job} />
              : null
          ))}
        </aside>
      </main>
    </div>
  );
}

function JobProgress({ job }: { job: ModelJobState }) {
  return (
    <div className="plateJobProgress" role="status" aria-live="polite">
      {job.status === "failed" ? (
        <>
          <span className="plateJobIcon" data-error aria-hidden="true">!</span>
          <span><strong>Слайсинг остановлен</strong><small>{jobErrorLabel(job.error)}</small></span>
        </>
      ) : (
        <>
          <span className="plateJobSpinner" aria-hidden="true" />
          <span><strong>{job.status === "queued" ? "В очереди Orca" : "Строим траектории"}</strong><small>Можно продолжать осматривать стол</small></span>
        </>
      )}
    </div>
  );
}

function JobOutcome({
  item,
  job,
  printerId,
}: {
  item: PlateItem | undefined;
  job: ModelJobState;
  printerId: string | null;
}) {
  const printTimeSeconds = typeof job.metrics?.print_time_seconds === "number"
    ? job.metrics.print_time_seconds
    : null;
  const filamentUsedG = typeof job.metrics?.filament_used_g === "number"
    ? job.metrics.filament_used_g
    : null;
  return (
    <section className="plateOutcome" aria-label="G-code готов">
      <div className="plateOutcomeMark" aria-hidden="true">✓</div>
      <div>
        <span className="plateEyebrow">G-code готов</span>
        <strong>{item?.title ?? "Модель"}</strong>
        {printTimeSeconds !== null || filamentUsedG !== null ? (
          <span className="plateOutcomeMetrics">
            {printTimeSeconds !== null ? `${Math.max(1, Math.round(printTimeSeconds / 60))} мин` : null}
            {printTimeSeconds !== null && filamentUsedG !== null ? " · " : null}
            {filamentUsedG !== null ? `${filamentUsedG.toFixed(1)} г` : null}
          </span>
        ) : null}
      </div>
      <Button
        onClick={() => job.jobId && navigate(slicePrintPath(job.jobId, {
          filename: `${item?.title ?? "model"}.gcode`,
          ...(printerId ? { printer_id: printerId } : {}),
        }))}
      >
        Готово — отправить на принтер
      </Button>
      <Button variant="secondary" onClick={() => job.gcodeUrl && triggerBrowserDownload(job.gcodeUrl)} disabled={!job.gcodeUrl}>
        Скачать G-code
      </Button>
    </section>
  );
}
