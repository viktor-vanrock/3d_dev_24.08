import { useEffect, useRef, useState, type DragEvent } from "react";
import type { SessionUser } from "@shared/types";
import { HomeHeader, type Section, useSectionSwipeNav } from "@platform/nav";
// eslint-disable-next-line boundaries/element-types, boundaries/entry-point -- легатное ребро (Этап 4.5): CSS side-effect, не index.ts; home.css остаётся общим "рабочим хромом" для доменных экранов, развязка отложена до pages/DI (Этап 10). См. MIGRATION.md.
import "@pages/home/home.css";
// eslint-disable-next-line boundaries/element-types, boundaries/entry-point -- CSS side-effect, не index.ts; легатное ребро ai→commerce (Этап 9): предпросмотр 3D-генерации переиспользует вьювер моделей каталога, см. ниже.
import "../../commerce/model.css";
// eslint-disable-next-line boundaries/element-types -- легатное междоменное ребро (Этап 9): ai→commerce ModelViewer (предпросмотр 3D-генерации переиспользует вьювер моделей каталога), развязка отложена до pages/DI. См. MIGRATION.md.
import { ModelViewer } from "@domains/commerce";
import { useOverlay } from "@platform/overlay";
import { modelPath, navigate } from "../../../router.ts";
import { AuroraBackground, Eyebrow, Heading, Input, SelectionTile, StatusPill } from "@shared/ui";
import { relativeDate, trackActivation } from "@shared/lib";
import {
  apiAssetUrl,
  createCatalogDraft,
  createGeneration,
  getGeneration,
  GENERATION_BRANCHES,
  listGenerations,
  uploadRudalleImage,
  type CreateGenerationError,
  type CreatableGenerationBranch,
  type Generation,
  type GenerationBranch,
} from "./generations.ts";
import "./generate.css";

/*
  Экран «Генерация по тексту» (docs/design/generation.md, MF-353 Фаза 3, MF-659): выбор ветки,
  промпт, поллинг статуса job'а с прогресс-кольцом на send-кнопке, предпросмотр результата
  (3D для openscad/STL — GAP-STL решён переиспользованием ModelViewer с STLLoader, см.
  market/modelscene.ts; картинка для kzd/hueforge), история генераций пользователя.
*/

const POLL_INTERVAL_MS = 2500;
const HISTORY_PAGE_SIZE = 10;
// apps/api/src/generations/contract.ts PROMPT_MAX_LENGTH — сервер источник истины, здесь только
// для maxLength инпута и текста ошибки, если сервер не прислал limit явно.
const PROMPT_MAX_LENGTH = 2000;

const BRANCH_META: Record<CreatableGenerationBranch, { label: string; placeholder: string; icon: () => React.JSX.Element }> = {
  openscad: { label: "3D-модель", placeholder: "Что напечатаем?", icon: CubeIcon },
  kzd: { label: "Чертёж КЗД", placeholder: "Что начертить?", icon: DraftIcon },
  hueforge: { label: "HueForge (много цветов)", placeholder: "Какую многоцветную сцену собрать?", icon: LayersIcon },
  trellis: { label: "3D по референсам", placeholder: "Что смоделировать по референс-изображениям?", icon: ScanIcon },
  rudalle: { label: "3D из текста (Kandinsky)", placeholder: "Опишите что нужно смоделировать...", icon: CubeIcon },
  rudalle_image: { label: "3D по картинке (Kandinsky)", placeholder: "Загрузите изображение для 3D-модели", icon: ImageIcon },
};

function branchMeta(branch: GenerationBranch) {
  return branch === "concepts"
    ? { label: "Ракурсы идеи", placeholder: "Что показать?", icon: ScanIcon }
    : BRANCH_META[branch];
}

function createErrorMessage(error: CreateGenerationError): string {
  switch (error.code) {
    case "PROMPT_REQUIRED":
      return "Опишите, что сгенерировать";
    case "PROMPT_TOO_LONG":
      return `Слишком длинный запрос (максимум ${error.limit ?? PROMPT_MAX_LENGTH} символов)`;
    case "PROMPT_NOT_ALLOWED":
      return "Запрос отклонён модерацией — попробуйте переформулировать";
    case "INVALID_PARAMS":
    case "PARAMS_TOO_LARGE":
      return "Некорректные дополнительные параметры";
    case "RATE_LIMITED":
      return `Лимит генераций ${error.scope === "hour" ? "в час" : "в сутки"} исчерпан${
        error.limit ? ` (${error.limit})` : ""
      } — попробуйте позже`;
    case "INVALID_BRANCH":
      return "Неизвестная ветка генерации";
    default:
      return "Не удалось отправить. Проверьте связь и попробуйте снова.";
  }
}

function jobErrorText(generation: Generation): string {
  if (generation.error_code === "timeout") return "Генератор не ответил вовремя. Попробуйте ещё раз.";
  if (generation.error && generation.error.length < 200) return generation.error;
  return "Генератор не справился. Попробуйте изменить запрос.";
}

export function GenerateScreen({
  user,
  section,
  onSectionChange,
  genId,
}: {
  user: SessionUser;
  section: Section;
  onSectionChange: (section: Section) => void;
  genId?: string;
}) {
  const overlay = useOverlay();
  const [branch, setBranch] = useState<CreatableGenerationBranch>("rudalle");
  const [prompt, setPrompt] = useState("");
  const [kandiMode, setKandiMode] = useState<"text" | "image">("text");
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [s3Key, setS3Key] = useState("");
  const [imageError, setImageError] = useState("");
  const [uploading, setUploading] = useState(false);
  const [hint, setHint] = useState("");
  const [paramsOpen, setParamsOpen] = useState(false);
  const [targetSizeMm, setTargetSizeMm] = useState("");
  const [layerHeightMm, setLayerHeightMm] = useState("");
  const [numTargetFaces, setNumTargetFaces] = useState(50_000);
  const [noTexture, setNoTexture] = useState(false);
  const [doQuadrification, setDoQuadrification] = useState(false);
  const [createLod, setCreateLod] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [inlineError, setInlineError] = useState<string | null>(null);
  const [active, setActive] = useState<Generation | null>(null);
  const [history, setHistory] = useState<Generation[] | null>(null);
  const [historyPage, setHistoryPage] = useState(0);
  const activeRef = useRef<Generation | null>(null);
  const generationOutcomeIds = useRef(new Set<string>());
  const fileInputRef = useRef<HTMLInputElement>(null);
  activeRef.current = active;
  const swipe = useSectionSwipeNav(section, onSectionChange);

  useEffect(() => {
    void listGenerations().then((generations) => {
      setHistory(generations);
      setHistoryPage(0);
    });
  }, []);

  // Второй вход (Дом → hero-инпут, docs/design/generation.md §1): генерация уже создана,
  // подхватываем её статус вместо пустой формы.
  useEffect(() => {
    if (!genId) return;
    let cancelled = false;
    void getGeneration(genId).then((result) => {
      if (cancelled || !result) return;
      setActive(result);
      if (result.branch !== "concepts") setBranch(result.branch);
      if (result.branch === "rudalle_image") setKandiMode("image");
      if (result.branch === "rudalle") setKandiMode("text");
      setPrompt(result.prompt);
    });
    return () => {
      cancelled = true;
    };
  }, [genId]);

  // Поллинг статуса job'а, пока не done/error (паттерн market/model.tsx для конвертации моделей).
  useEffect(() => {
    const current = activeRef.current;
    if (!current || current.status === "done" || current.status === "error") return;
    const interval = setInterval(() => {
      void getGeneration(current.id).then((result) => {
        if (result) setActive(result);
      });
    }, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [active?.id, active?.status]);

  // Новая запись в истории по завершении job'а.
  useEffect(() => {
    if (active?.status === "done" || active?.status === "error") {
      void listGenerations().then((generations) => {
        setHistory(generations);
        setHistoryPage(0);
      });
    }
  }, [active?.status]);

  // Завершение фиксируем ровно раз для каждой генерации на этом экране: polling может
  // отдать тот же terminal-статус несколько раз, но воронке нужен первый наблюдаемый исход.
  useEffect(() => {
    if (!active || (active.status !== "done" && active.status !== "error") || generationOutcomeIds.current.has(active.id)) return;
    generationOutcomeIds.current.add(active.id);
    trackActivation("generation_outcome", {
      generation_id: active.id,
      branch: active.branch,
      status: active.status,
      error_code: active.error_code,
    });
  }, [active]);

  const busy = submitting || active?.status === "queued" || active?.status === "running";
  const collapsed = active?.status === "done";
  const SelectedBranchIcon = BRANCH_META[branch].icon;
  const submitLabel = active?.status === "error" ? "Повторить" : busy ? "Генерация…" : "Сгенерировать";
  const isKandinsky = branch === "rudalle" || branch === "rudalle_image";
  const historyPageCount = history ? Math.ceil(history.length / HISTORY_PAGE_SIZE) : 0;
  const visibleHistory = history?.slice(
    historyPage * HISTORY_PAGE_SIZE,
    (historyPage + 1) * HISTORY_PAGE_SIZE,
  );

  function resetImage() {
    setImageFile(null);
    setS3Key("");
    setHint("");
    setImageError("");
    setUploading(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function changeKandiMode(mode: "text" | "image") {
    setKandiMode(mode);
    setBranch(mode === "text" ? "rudalle" : "rudalle_image");
    setInlineError(null);
    resetImage();
    setNumTargetFaces(50_000);
    setNoTexture(false);
    setDoQuadrification(false);
    setCreateLod(0);
  }

  async function selectImage(file: File | undefined) {
    if (!file || uploading) return;
    const allowedTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
    if (!allowedTypes.has(file.type)) {
      setImageError("Поддерживаются только JPG, PNG, WebP");
      return;
    }
    if (file.size > 10 * 1_024 * 1_024) {
      setImageError("Файл слишком большой. Максимум 10 МБ");
      return;
    }
    setImageError("");
    setUploading(true);
    const result = await uploadRudalleImage(file);
    setUploading(false);
    if ("error" in result) {
      setImageError(result.error);
      return;
    }
    setS3Key(result.s3_key);
    setImageFile(file);
  }

  function resolveParams(forBranch: CreatableGenerationBranch): Record<string, unknown> | undefined {
    if (forBranch === "rudalle" || forBranch === "rudalle_image") {
      return {
        num_target_faces: numTargetFaces,
        no_texture: noTexture,
        do_quadrification: doQuadrification,
        create_lod: createLod,
      };
    }
    if (forBranch === "openscad" && targetSizeMm.trim()) {
      const value = Number(targetSizeMm);
      if (Number.isFinite(value) && value > 0) return { target_size_mm: value };
    }
    if (forBranch === "hueforge" && layerHeightMm.trim()) {
      const value = Number(layerHeightMm);
      if (Number.isFinite(value) && value > 0) return { layer_height_mm: value };
    }
    return undefined;
  }

  async function submit(overrideBranch?: CreatableGenerationBranch, overridePrompt?: string) {
    const usedBranch = overrideBranch ?? branch;
    const usedPrompt = (overridePrompt ?? (usedBranch === "rudalle_image" ? hint : prompt)).trim();
    if (usedBranch === "rudalle_image" && !s3Key) {
      setImageError("Сначала загрузите изображение");
      return;
    }
    if (usedBranch !== "rudalle_image" && !usedPrompt) {
      setInlineError("Опишите, что сгенерировать");
      return;
    }
    setInlineError(null);
    setSubmitting(true);
    const result = await createGeneration({
      branch: usedBranch,
      prompt: usedPrompt,
      params: usedBranch === "rudalle_image" ? { s3_key: s3Key, ...resolveParams(usedBranch) } : resolveParams(usedBranch),
    });
    setSubmitting(false);
    if ("error" in result) {
      if (result.error.code === "NETWORK") {
        overlay.toast({
          severity: "critical",
          title: "Не удалось отправить",
          message: "Проверьте связь и попробуйте снова.",
          duration: "sticky",
          action: { label: "Повторить", onAction: () => void submit(overrideBranch, overridePrompt) },
        });
        return;
      }
      setInlineError(createErrorMessage(result.error));
      return;
    }
    setActive(result.generation);
  }

  function openHistoryRow(generation: Generation) {
    setActive(generation);
    if (generation.branch !== "concepts") setBranch(generation.branch);
    if (generation.branch === "rudalle_image") setKandiMode("image");
    if (generation.branch === "rudalle") setKandiMode("text");
    setPrompt(generation.prompt);
    setInlineError(null);
  }

  return (
    <div className="home">
      <AuroraBackground />
      <div style={{ position: "relative", zIndex: 30 }}>
        <HomeHeader user={user} printers={[]} section={section} onSectionChange={onSectionChange} />
      </div>
      <main
        className="homeContent generatePage"
        style={swipe.dragX !== 0 ? { transform: `translateX(${swipe.dragX}px)` } : undefined}
        onPointerDown={swipe.onPointerDown}
        onPointerMove={swipe.onPointerMove}
        onPointerUp={swipe.onPointerUp}
        onPointerCancel={swipe.onPointerCancel}
      >
        <Heading size='md' accent="по тексту и изображению">Генерация</Heading>

        {collapsed && active ? (
          <div className="generateCompactStrip">
            <StatusPill tone="dim">{branchMeta(active.branch).label}</StatusPill>
            <span className="generateCompactPrompt">{active.prompt}</span>
          </div>
        ) : (
          <div className="generateForm">
            {busy ? (
              <div className="generateBranchSummary" aria-label={`Выбранный режим: ${BRANCH_META[branch].label}`}>
                <SelectedBranchIcon />
                <span>{BRANCH_META[branch].label}</span>
              </div>
            ) : (
              <div className="generateBranchRow" aria-label="Режим генерации">
                {GENERATION_BRANCHES.filter((b) => b !== "rudalle_image").sort((a, b) => (a === "rudalle" ? -1 : b === "rudalle" ? 1 : 0)).map((b) => {
                  const BranchIcon = BRANCH_META[b].icon;
                  return (
                    <SelectionTile
                      key={b}
                      selected={branch === b || (b === "rudalle" && branch === "rudalle_image")}
                      disabled={b !== "rudalle"}
                      onClick={() => {
                        if (b === "rudalle") changeKandiMode("text");
                        else setBranch(b);
                      }}
                      className="generateBranchTile"
                    >
                      <span className="generateBranchIcon">
                        <BranchIcon />
                      </span>
                      {BRANCH_META[b].label}
                    </SelectionTile>
                  );
                })}
              </div>
            )}

            {isKandinsky ? (
              <div className="generateKandiTabs" role="tablist" aria-label="Режим Кандинского">
                <button type="button" className="generateKandiTab pressable" role="tab" aria-selected={kandiMode === "text"} onClick={() => changeKandiMode("text")} disabled={busy}>
                  По тексту
                </button>
                <button type="button" className="generateKandiTab pressable" role="tab" aria-selected={kandiMode === "image"} onClick={() => changeKandiMode("image")} disabled={busy}>
                  По картинке
                </button>
              </div>
            ) : null}

            {branch === "rudalle_image" ? (
              <div className="generateImageMode">
                {uploading ? (
                  <div className="generateImageLoading" role="status">Загружаем изображение…</div>
                ) : imageFile ? (
                  <div className="generateImagePreview">
                    <img src={URL.createObjectURL(imageFile)} alt="Выбранное изображение" />
                    <div>
                      <strong>{imageFile.name}</strong>
                      <span>{(imageFile.size / (1_024 * 1_024)).toFixed(1)} МБ</span>
                    </div>
                    <button type="button" className="generateImageRemove pressable" aria-label="Удалить изображение" onClick={resetImage} disabled={busy}>×</button>
                  </div>
                ) : (
                  <div
                    className="generateImageDropzone"
                    role="button"
                    tabIndex={0}
                    onClick={() => fileInputRef.current?.click()}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") fileInputRef.current?.click();
                    }}
                    onDragOver={(event: DragEvent) => event.preventDefault()}
                    onDrop={(event: DragEvent) => {
                      event.preventDefault();
                      void selectImage(event.dataTransfer.files[0]);
                    }}
                  >
                    <ImageIcon />
                    <strong>Перетащите картинку или нажмите для выбора</strong>
                    <span>JPG, PNG, WebP — до 10 МБ</span>
                  </div>
                )}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  hidden
                  onChange={(event) => {
                    void selectImage(event.target.files?.[0]);
                    event.target.value = "";
                  }}
                />
                {imageError ? <div className="generateInlineError">{imageError}</div> : null}
                {imageFile ? (
                  <textarea
                    className="homeGhostInput generateHintInput"
                    value={hint}
                    onChange={(event) => setHint(event.target.value)}
                    placeholder="Необязательно: «сделай красным», «добавь крылья»..."
                    rows={2}
                    maxLength={PROMPT_MAX_LENGTH}
                    disabled={busy}
                  />
                ) : null}
              </div>
            ) : null}

            <div className="generatePromptRow">
              {branch !== "rudalle_image" ? (
                <input
                  className="homeGhostInput generatePromptInput"
                  value={prompt}
                  onChange={(event) => setPrompt(event.target.value)}
                  placeholder={BRANCH_META[branch].placeholder}
                  aria-label={BRANCH_META[branch].placeholder}
                  readOnly={busy}
                  maxLength={PROMPT_MAX_LENGTH}
                />
              ) : null}
              <button
                key={active?.id ?? "idle"}
                type="button"
                className="pressable homeSendButton generateSendButton"
                aria-label={submitLabel}
                data-armed={(branch === "rudalle_image" ? Boolean(s3Key) : prompt.trim().length > 0) || undefined}
                data-status={active?.status ?? (submitting ? "queued" : undefined)}
                disabled={busy}
                onClick={() => void submit()}
              >
                {submitLabel}
              </button>
            </div>

            {active?.status === "queued" || active?.status === "running" ? (
              <div className="generateStatusRow">
                <StatusPill tone={active.status === "running" ? "ok" : "dim"} pulse={active.status === "running"}>
                  {active.status === "running" ? "Идёт генерация" : "В очереди"}
                </StatusPill>
              </div>
            ) : null}

            {active?.status === "error" ? (
              <div className="generateStatusRow">
                <StatusPill tone="danger">Не удалось</StatusPill>
                <span className="generateErrorText">{jobErrorText(active)}</span>
              </div>
            ) : null}

            {inlineError && !active ? <div className="generateInlineError">{inlineError}</div> : null}

            {!busy && branch !== "kzd" ? (
              <button
                type="button"
                className="generateParamsToggle pressable"
                onClick={() => setParamsOpen((value) => !value)}
                disabled={busy}
                aria-label="Дополнительные параметры"
                aria-expanded={paramsOpen}
                aria-controls="generate-extra-params"
              >
                Дополнительно <span aria-hidden="true" className="generateParamsChevron">v</span>
              </button>
            ) : null}

            {paramsOpen && branch !== "kzd" ? (
              <div id="generate-extra-params" className="generateParamsPanel">
                {branch === "rudalle" || branch === "rudalle_image" ? (
                  <>
                    <label className="generateParamField">
                      Детализация модели
                      <select value={numTargetFaces} onChange={(event) => setNumTargetFaces(Number(event.target.value))} disabled={busy}>
                        <option value={10_000}>Низкая — 10 000 полигонов</option>
                        <option value={50_000}>Стандарт — 50 000 полигонов</option>
                        <option value={100_000}>Высокая — 100 000 полигонов</option>
                        <option value={200_000}>Максимум — 200 000 полигонов</option>
                      </select>
                    </label>
                    <label className="generateParamField">
                      <span>
                        <input type="checkbox" checked={noTexture} onChange={(event) => setNoTexture(event.target.checked)} disabled={busy} /> Без текстуры
                      </span>
                      <small>Генерировать модель без цветов и текстур</small>
                    </label>
                    <label className="generateParamField">
                      <span>
                        <input type="checkbox" checked={doQuadrification} onChange={(event) => setDoQuadrification(event.target.checked)} disabled={busy} /> Квадрификация
                      </span>
                      <small>Преобразовать треугольники в четырёхугольники</small>
                    </label>
                    <label className="generateParamField">
                      LOD копии
                      <select value={createLod} onChange={(event) => setCreateLod(Number(event.target.value))} disabled={busy}>
                        <option value={0}>Не создавать</option>
                        <option value={1}>1 копия</option>
                        <option value={2}>2 копии</option>
                      </select>
                      <small>Упрощённые копии для разных дистанций</small>
                    </label>
                  </>
                ) : null}
                {branch === "openscad" ? (
                  <label className="generateParamField">
                    Целевой размер, мм
                    <Input
                      type="number"
                      min={1}
                      value={targetSizeMm}
                      onChange={(event) => setTargetSizeMm(event.target.value)}
                      disabled={busy}
                      placeholder="напр. 80"
                    />
                  </label>
                ) : null}
                {branch === "hueforge" ? (
                  <label className="generateParamField">
                    Толщина слоя, мм
                    <Input
                      type="number"
                      step="0.01"
                      min={0.01}
                      value={layerHeightMm}
                      onChange={(event) => setLayerHeightMm(event.target.value)}
                      disabled={busy}
                      placeholder="по умолчанию 0.08"
                    />
                  </label>
                ) : null}
              </div>
            ) : null}
          </div>
        )}

        {active?.status === "done" ? (
          <GenerationPreview generation={active} onAgain={() => setActive(null)} />
        ) : null}

        {history && history.length > 0 ? (
          <section className="generateHistory">
            <Eyebrow>История</Eyebrow>
            <div className="generateHistoryList stagger-reveal">
              {visibleHistory?.map((row, index) => (
                <button
                  key={row.id}
                  type="button"
                  className="generateHistoryRow pressable"
                  style={{ ["--i" as string]: index }}
                  onClick={() => openHistoryRow(row)}
                >
                  <HistoryThumb generation={row} />
                  <span className="generateHistoryPrompt">{row.prompt}</span>
                  <StatusPill tone={row.status === "done" ? "ok" : row.status === "error" ? "danger" : "dim"} pulse={row.status === "running"}>
                    {row.status === "done" ? "Готово" : row.status === "error" ? "Ошибка" : row.status === "running" ? "Идёт" : "В очереди"}
                  </StatusPill>
                  <span className="generateHistoryTime">{relativeDate(row.created_at)}</span>
                </button>
              ))}
            </div>
            {historyPageCount > 1 ? (
              <nav className="generateHistoryPagination" aria-label="Страницы истории генераций">
                <button
                  type="button"
                  className="generateHistoryPageButton pressable"
                  onClick={() => setHistoryPage((page) => Math.max(0, page - 1))}
                  disabled={historyPage === 0}
                >
                  Назад
                </button>
                <span className="generateHistoryPageInfo">
                  Страница {historyPage + 1} из {historyPageCount}
                </span>
                <button
                  type="button"
                  className="generateHistoryPageButton pressable"
                  onClick={() => setHistoryPage((page) => Math.min(historyPageCount - 1, page + 1))}
                  disabled={historyPage === historyPageCount - 1}
                >
                  Далее
                </button>
              </nav>
            ) : null}
          </section>
        ) : null}
      </main>
    </div>
  );
}

function HistoryThumb({ generation }: { generation: Generation }) {
  if (generation.branch !== "openscad" && generation.branch !== "trellis" && generation.preview_url) {
    return (
      <span className="generateHistoryThumb">
        <img src={apiAssetUrl(generation.preview_url)} alt="" loading="lazy" />
      </span>
    );
  }
  const BranchIcon = branchMeta(generation.branch).icon;
  return (
    <span className="generateHistoryThumb generateHistoryThumbGlyph">
      <BranchIcon />
    </span>
  );
}

// Предпросмотр готового результата (docs/design/generation.md §4): 3D для openscad (STL —
// GAP-STL, ModelViewer format="stl"), GLB/OBJ для trellis/rudalle и картинка для kzd/hueforge (оба
// отдают preview_url — для hueforge это квантованный PNG, apps/giga/src/giga/branches/hueforge.py).
function GenerationPreview({ generation, onAgain }: { generation: Generation; onAgain: () => void }) {
  const overlay = useOverlay();
  const [creatingDraft, setCreatingDraft] = useState(false);

  function openFullscreen() {
    if (!generation.preview_url) return;
    const src = apiAssetUrl(generation.preview_url);
    const handle = overlay.modal({
      content: (
        <div className="generatePreviewFullscreen">
          <button type="button" className="uiIconButton pressable generatePreviewClose" aria-label="Закрыть" onClick={() => handle.close()}>
            <CloseIcon />
          </button>
          <img src={src} alt="" />
        </div>
      ),
    });
  }

  const downloadLabel =
    generation.branch === "openscad"
      ? "Скачать STL"
      : generation.branch === "trellis" || generation.branch === "rudalle" || generation.branch === "rudalle_image"
        ? "Скачать 3D-модель"
        : generation.branch === "hueforge"
          ? "Скачать архив"
          : "Скачать PNG";
  // kzd — чертёж, а RuDALL-E возвращает GLB; каталог пока не принимает эти форматы.
  const cardCreationUnsupported = generation.branch === "kzd" || generation.branch === "rudalle" || generation.branch === "rudalle_image";

  async function createCard() {
    if (creatingDraft) return;
    setCreatingDraft(true);
    const result = await createCatalogDraft(generation.id);
    setCreatingDraft(false);
    if ("error" in result) {
      overlay.toast({
        severity: "critical",
        title: "Не удалось создать карточку",
        message: result.error === "NETWORK" ? "Проверьте связь и попробуйте снова." : "Попробуйте ещё раз.",
        duration: "sticky",
        action: { label: "Повторить", onAction: () => void createCard() },
      });
      return;
    }
    navigate(modelPath(result.modelId));
  }

  return (
    <div className="generatePreview">
      <div className="generateSuccessBadge">
        <CheckIcon /> Готово
      </div>

      {generation.branch === "openscad" ? (
        <ModelViewer modelId={generation.id} title={generation.prompt} previewUrl={generation.artifact_url} thumbUrl={null} format="stl" />
      ) : generation.branch === "trellis" || generation.branch === "rudalle" || generation.branch === "rudalle_image" ? (
        <ModelViewer
          modelId={generation.id}
          title={generation.prompt}
          previewUrl={generation.preview_url ?? generation.artifact_url}
          thumbUrl={null}
          format={isObjArtifact(generation.preview_url ?? generation.artifact_url) ? "obj" : "gltf"}
        />
      ) : generation.preview_url ? (
        <button type="button" className="generateImageFrame pressable reveal" onClick={openFullscreen}>
          <img src={apiAssetUrl(generation.preview_url)} alt="" />
        </button>
      ) : null}

      <div className="generatePreviewActions">
        {generation.artifact_url ? (
          <a className="modelGlassBtn pressable" href={apiAssetUrl(generation.artifact_url)} download>
            <DownloadIcon /> {downloadLabel}
          </a>
        ) : null}
        <button type="button" className="modelGlassBtn pressable" onClick={onAgain}>
          Сгенерировать ещё
        </button>
        <button
          type="button"
          className="modelGlassBtn pressable"
          onClick={() => void createCard()}
          disabled={creatingDraft || cardCreationUnsupported}
        >
          <CardIcon /> {creatingDraft ? "Создаём…" : "Создать карточку"}
        </button>
      </div>
    </div>
  );
}

function isObjArtifact(url: string | null): boolean {
  return url?.split(/[?#]/, 1)[0]?.toLowerCase().endsWith(".obj") ?? false;
}

function CheckIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="m5 12.5 4.5 4.5L19 7" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M6 6l12 12M18 6 6 18" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function DownloadIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 4v11m0 0 4-4m-4 4-4-4M5 19h14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CardIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="3.5" y="5" width="17" height="14" rx="2.2" stroke="currentColor" strokeWidth="1.6" />
      <path d="M3.5 10h17M8 14.5h4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function CubeIcon() {
  return (
    <svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 3l8 4.5v9L12 21l-8-4.5v-9L12 3Zm0 0v9m0 9v-9m0 0L4 7.5M12 12l8-4.5" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  );
}

function DraftIcon() {
  return (
    <svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M4 20 15 9m0 0 5-5M9 20H4v-5m14-9 3 3-3 3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function LayersIcon() {
  return (
    <svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="m12 3 9 5-9 5-9-5 9-5Zm-9 9 9 5 9-5" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  );
}

// Референс-виды (front/back/left, apps/giga/src/giga/branches/trellis.py) собираются в объём —
// три перекрывающихся кадра, тот же визуальный приём, что мультивью-иконки в фоторедакторах.
function ScanIcon() {
  return (
    <svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="3" y="7" width="12" height="12" rx="2" stroke="currentColor" strokeWidth="1.6" />
      <path d="M8 7V5a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function ImageIcon() {
  return (
    <svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="3" y="4" width="18" height="16" rx="2" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="8.5" cy="9" r="1.5" stroke="currentColor" strokeWidth="1.6" />
      <path d="m4 18 5.5-5 3.5 3 2.5-2 4.5 4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
