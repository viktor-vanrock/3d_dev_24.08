import { useEffect, useMemo, useState } from "react";
import type { SessionUser } from "@shared/types";
import { HomeHeader, type Section } from "@platform/nav";
import { AuroraBackground, CubeIcon, EmptyState } from "@shared/ui";
import {
  feedNewPath,
  headerModeFor,
  modelPath,
  navigate,
  platePath,
  profilePath,
} from "../../router.ts";
import {
  getProjectBuildGuide,
  type ProjectBuildGuide,
  type ProjectBuildStep,
} from "./buildguide.ts";
import { MarkdownBody } from "./markdown.tsx";
import { ModelViewer } from "./modelviewer.tsx";
import { getModel, type ModelDetail } from "./models.ts";
import { projectConfigurationFor, type ProjectConfiguration } from "./projectconfig.ts";
import { apiAssetUrl } from "@shared/api";
import "./projectbuild.css";

type BuildPhase = "print" | "assembly" | "flash" | "solder" | "check";

interface StoredBuildProgress {
  doneStepIds: string[];
  currentStepId: string | null;
  updatedAt: string;
}

const PHASE_META: Record<BuildPhase, { number: string; label: string }> = {
  print: { number: "01", label: "Печать" },
  assembly: { number: "02", label: "Сборка" },
  flash: { number: "03", label: "Код" },
  solder: { number: "04", label: "Электрика" },
  check: { number: "05", label: "Проверка" },
};

export function ProjectBuildScreen({
  user,
  section,
  onSectionChange,
  id,
  configId,
}: {
  user: SessionUser;
  section: Section;
  onSectionChange: (section: Section) => void;
  id: string;
  configId?: string;
}) {
  const [model, setModel] = useState<ModelDetail | null | undefined>(undefined);
  const [guide, setGuide] = useState<ProjectBuildGuide | null | undefined>(undefined);

  useEffect(() => {
    // SPA-переход с нижней части лендинга не должен переносить ту же позицию
    // в личную сессию: здесь начинается новый сфокусированный рабочий контекст.
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
  }, [configId, id]);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([getModel(id), getProjectBuildGuide(id)]).then(([nextModel, nextGuide]) => {
      if (cancelled) return;
      setModel(nextModel);
      setGuide(nextGuide);
    });
    return () => {
      cancelled = true;
    };
  }, [id]);

  return (
    <div className="home projectBuildPage">
      <AuroraBackground />
      <div className="projectBuildHeaderLayer">
        <HomeHeader
          user={user}
          printers={[]}
          section={section}
          activeSection="market"
          onSectionChange={onSectionChange}
          onBack={() => navigate(modelPath(id))}
          backLabel="К проекту"
          mode={headerModeFor("project-build", { withBack: true })}
        />
      </div>
      <main className="homeContent homeWorkspaceBody projectBuildBody">
        {model === undefined || guide === undefined ? null : model === null ? (
          <EmptyState
            icon={<CubeIcon />}
            title="Проект не найден"
            sub="Вернитесь к витрине и выберите доступную конфигурацию."
            action={
              <button type="button" className="projectBuildSecondary pressable" onClick={() => navigate(modelPath(id))}>
                К проекту
              </button>
            }
          />
        ) : (
          <ProjectBuildWorkspace user={user} model={model} guide={guide} configId={configId} />
        )}
      </main>
    </div>
  );
}

function ProjectBuildWorkspace({
  user,
  model,
  guide,
  configId,
}: {
  user: SessionUser;
  model: ModelDetail;
  guide: ProjectBuildGuide | null;
  configId?: string;
}) {
  const configuration = projectConfigurationFor(model, configId);
  const steps = useMemo(() => actionableSteps(guide, model), [guide, model]);
  const storageKey = `project-build:${user.id}:${model.id}:${configuration.id}:v${guide?.version ?? 1}`;
  const [doneStepIds, setDoneStepIds] = useState<string[]>([]);
  const [currentStepId, setCurrentStepId] = useState<string | null>(steps[0]?.id ?? null);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const stored = readStoredProgress(storageKey);
    const knownIds = new Set(steps.map((step) => step.id));
    const restoredDone = stored?.doneStepIds.filter((stepId) => knownIds.has(stepId)) ?? [];
    const firstOpen = steps.find((step) => !restoredDone.includes(step.id))?.id ?? steps.at(-1)?.id ?? null;
    setDoneStepIds(restoredDone);
    setCurrentStepId(stored?.currentStepId && knownIds.has(stored.currentStepId) ? stored.currentStepId : firstOpen);
    setHydrated(true);
  }, [steps, storageKey]);

  useEffect(() => {
    if (!hydrated) return;
    const progress: StoredBuildProgress = {
      doneStepIds,
      currentStepId,
      updatedAt: new Date().toISOString(),
    };
    window.localStorage.setItem(storageKey, JSON.stringify(progress));
  }, [currentStepId, doneStepIds, hydrated, storageKey]);

  const currentIndex = Math.max(0, steps.findIndex((step) => step.id === currentStepId));
  const currentStep = steps[currentIndex] ?? steps[0];
  const complete = steps.length > 0 && steps.every((step) => doneStepIds.includes(step.id));
  const percent = steps.length ? Math.round((doneStepIds.length / steps.length) * 100) : 0;

  function chooseStep(stepId: string) {
    setCurrentStepId(stepId);
  }

  function markCurrentDone() {
    if (!currentStep) return;
    setDoneStepIds((previous) => (previous.includes(currentStep.id) ? previous : [...previous, currentStep.id]));
    const next = steps[currentIndex + 1];
    if (next) setCurrentStepId(next.id);
  }

  function reopenCurrent() {
    if (!currentStep) return;
    setDoneStepIds((previous) => previous.filter((stepId) => stepId !== currentStep.id));
  }

  if (steps.length === 0 || !currentStep) {
    return (
      <EmptyState
        icon={<CubeIcon />}
        title="Инструкция ещё готовится"
        sub="Файлы проекта уже доступны на лендинге, но автор пока не разложил работу на действия."
        action={
          <button type="button" className="projectBuildSecondary pressable" onClick={() => navigate(modelPath(model.id))}>
            Вернуться к проекту
          </button>
        }
      />
    );
  }

  return (
    <>
      <section className="projectBuildIntro">
        <div>
          <span className="projectBuildKicker">Личная сборка · {configuration.label}</span>
          <h1>{configuration.title}</h1>
          <p>{configuration.summary}</p>
        </div>
        <div className="projectBuildProgress" aria-label={`Выполнено ${percent}%`}>
          <strong>{percent}%</strong>
          <span>{doneStepIds.length} из {steps.length} действий</span>
          <div><i style={{ width: `${percent}%` }} /></div>
          <small>Прогресс этой версии сохраняется на устройстве</small>
        </div>
      </section>

      <div className="projectBuildWorkspace">
        <aside className="projectBuildRail" aria-label="Фазы проекта">
          <div className="projectBuildRailTitle">
            <span>Маршрут</span>
            <strong>{model.title}</strong>
          </div>
          <ol>
            {steps.map((step, index) => {
              const phase = phaseFor(step);
              const done = doneStepIds.includes(step.id);
              const current = step.id === currentStep.id;
              return (
                <li key={step.id}>
                  <button
                    type="button"
                    className="projectBuildStepButton pressable"
                    data-current={current || undefined}
                    data-done={done || undefined}
                    onClick={() => chooseStep(step.id)}
                    aria-current={current ? "step" : undefined}
                  >
                    <span>{done ? "✓" : String(index + 1).padStart(2, "0")}</span>
                    <span>
                      <small>{PHASE_META[phase].label}</small>
                      <strong>{step.title}</strong>
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
        </aside>

        <article className="projectBuildStage">
          {complete ? (
            <BuildComplete model={model} configuration={configuration} user={user} />
          ) : (
            <BuildStepArticle
              model={model}
              configuration={configuration}
              step={currentStep}
              index={currentIndex}
              count={steps.length}
              isDone={doneStepIds.includes(currentStep.id)}
              canGoBack={currentIndex > 0}
              canGoNext={currentIndex < steps.length - 1}
              onBack={() => setCurrentStepId(steps[currentIndex - 1]?.id ?? currentStep.id)}
              onNext={() => setCurrentStepId(steps[currentIndex + 1]?.id ?? currentStep.id)}
              onDone={markCurrentDone}
              onReopen={reopenCurrent}
            />
          )}
        </article>
      </div>
    </>
  );
}

function BuildStepArticle({
  model,
  configuration,
  step,
  index,
  count,
  isDone,
  canGoBack,
  canGoNext,
  onBack,
  onNext,
  onDone,
  onReopen,
}: {
  model: ModelDetail;
  configuration: ProjectConfiguration;
  step: ProjectBuildStep;
  index: number;
  count: number;
  isDone: boolean;
  canGoBack: boolean;
  canGoNext: boolean;
  onBack: () => void;
  onNext: () => void;
  onDone: () => void;
  onReopen: () => void;
}) {
  const phase = phaseFor(step);
  const entries = [...namedEntries(step.parts), ...namedEntries(step.tools)];
  const artifacts = step.artifacts ?? [];
  const hasCodeFirstContent = artifacts.length > 0 || Boolean(step.commands?.length || step.checklist?.length || step.source);
  const photo = step.photos[0]?.url ?? (hasCodeFirstContent ? null : configuration.imageUrl);
  const [selectedArtifactId, setSelectedArtifactId] = useState<string | null>(artifacts[0]?.id ?? null);
  const [copiedCommand, setCopiedCommand] = useState<number | null>(null);
  const selectedArtifact = artifacts.find((artifact) => artifact.id === selectedArtifactId) ?? artifacts[0] ?? null;

  useEffect(() => {
    setSelectedArtifactId(step.artifacts?.[0]?.id ?? null);
    setCopiedCommand(null);
  }, [step.id, step.artifacts]);

  async function copyCommand(command: string, commandIndex: number) {
    try {
      await navigator.clipboard.writeText(command);
      setCopiedCommand(commandIndex);
    } catch {
      setCopiedCommand(null);
    }
  }

  return (
    <>
      <div
        className="projectBuildStageMedia"
        data-empty={!photo && !selectedArtifact || undefined}
        data-artifact={selectedArtifact?.id}
      >
        {selectedArtifact?.format === "stl" ? (
          <div className="projectBuildArtifactViewer">
            <ModelViewer
              modelId={`${model.id}:${selectedArtifact.id}`}
              title={selectedArtifact.label}
              previewUrl={selectedArtifact.url}
              thumbUrl={null}
              format="stl"
            />
          </div>
        ) : photo ? (
          <img src={apiAssetUrl(photo)} alt="" />
        ) : (
          <span>{PHASE_META[phase].number}</span>
        )}
        <div className="projectBuildStageMeta">
          <span>{PHASE_META[phase].number} · {PHASE_META[phase].label}</span>
          <strong>{index + 1} / {count}</strong>
        </div>
      </div>
      <div className="projectBuildStageContent">
        <span className="projectBuildKicker">{PHASE_META[phase].label} · текущий этап</span>
        <h2>{step.title}</h2>
        <div className="projectBuildInstruction">
          <MarkdownBody source={step.body ?? "Выполните действие по инструкции автора и проверьте результат."} />
        </div>

        {artifacts.length ? (
          <section className="projectBuildArtifacts" aria-label="Файлы этого шага">
            <div className="projectBuildSectionHead">
              <div>
                <span>Файлы шага</span>
                <h3>{artifacts.length === 1 ? "Что печатаем сейчас" : "Выберите деталь"}</h3>
              </div>
              {selectedArtifact ? <small>{selectedArtifact.path}</small> : null}
            </div>
            <div className="projectBuildArtifactTabs">
              {artifacts.map((artifact, artifactIndex) => (
                <button
                  type="button"
                  key={artifact.id}
                  className="projectBuildArtifactTab pressable"
                  data-current={artifact.id === selectedArtifact?.id || undefined}
                  onClick={() => setSelectedArtifactId(artifact.id)}
                >
                  <span>{String(artifactIndex + 1).padStart(2, "0")}</span>
                  <span>
                    <strong>{artifact.label}</strong>
                    <small>{artifact.quantity ?? artifact.role}</small>
                  </span>
                </button>
              ))}
            </div>
            {selectedArtifact?.note ? <p>{selectedArtifact.note}</p> : null}
          </section>
        ) : null}

        {entries.length ? (
          <section className="projectBuildNeed" aria-label="Что понадобится">
            <h3>Подготовьте для этого шага</h3>
            <ul>
              {entries.map((entry, entryIndex) => (
                <li key={`${entry.name}-${entryIndex}`}>
                  <span>{entry.name}</span>
                  {entry.quantity ? <strong>{entry.quantity}</strong> : null}
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {step.warnings?.length ? (
          <section className="projectBuildWarnings" aria-label="Важно перед продолжением">
            <h3>Перед продолжением</h3>
            <ul>
              {step.warnings.map((warning) => <li key={warning}>{warning}</li>)}
            </ul>
          </section>
        ) : null}

        {step.commands?.length ? (
          <section className="projectBuildCommands" aria-label="Команды">
            <div className="projectBuildSectionHead">
              <div>
                <span>Команды из инструкции</span>
                <h3>Запустите по порядку</h3>
              </div>
            </div>
            {step.commands.map((command, commandIndex) => (
              <div className="projectBuildCommand" key={`${command.label}-${commandIndex}`}>
                <div>
                  <strong>{command.label}</strong>
                  {command.note ? <small>{command.note}</small> : null}
                </div>
                <pre><code>{command.code}</code></pre>
                <button
                  type="button"
                  className="projectBuildSecondary pressable"
                  onClick={() => void copyCommand(command.code, commandIndex)}
                >
                  {copiedCommand === commandIndex ? "Скопировано ✓" : "Копировать"}
                </button>
              </div>
            ))}
          </section>
        ) : null}

        {step.checklist?.length ? (
          <section className="projectBuildChecklist" aria-label="Проверка результата">
            <h3>Проверьте результат шага</h3>
            <ul>
              {step.checklist.map((item) => (
                <li key={item}><span aria-hidden="true">✓</span>{item}</li>
              ))}
            </ul>
          </section>
        ) : null}

        {step.source ? (
          <a className="projectBuildSource" href={step.source.url} target="_blank" rel="noreferrer">
            <span>Источник на закреплённой версии</span>
            <strong>{step.source.label} ↗</strong>
            {step.source.locator ? <small>{step.source.locator}</small> : null}
          </a>
        ) : null}

        <div className="projectBuildPrimaryActions">
          {phase === "print" ? (
            <button
              type="button"
              className="projectBuildAction pressable"
              onClick={() =>
                navigate(platePath(model.id, {
                  ...(selectedArtifact ? { artifactId: selectedArtifact.id } : {}),
                  stepId: step.id,
                }))
              }
            >
              Открыть в слайсере
              <small>{selectedArtifact ? `${selectedArtifact.label} · Snapmaker U1 пилот` : "Открыть плиту и выбрать принтер"}</small>
            </button>
          ) : null}
          {phase === "flash" && model.repo_url ? (
            <a className="projectBuildAction pressable" href={model.repo_url} target="_blank" rel="noreferrer">
              Открыть код проекта
              <small>Репозиторий и команды установки</small>
            </a>
          ) : null}
          {isDone ? (
            <button type="button" className="projectBuildDone pressable" onClick={onReopen}>
              ✓ Этап выполнен
              <small>Нажмите, чтобы отметить заново</small>
            </button>
          ) : (
            <button type="button" className="projectBuildDone pressable" onClick={onDone}>
              Я выполнил этот этап
              <small>Сохранить результат и продолжить</small>
            </button>
          )}
        </div>

        <footer className="projectBuildStageFooter">
          <button type="button" className="projectBuildSecondary pressable" onClick={onBack} disabled={!canGoBack}>
            ← Назад
          </button>
          <button type="button" className="projectBuildSecondary pressable" onClick={onNext} disabled={!canGoNext}>
            Посмотреть следующий →
          </button>
        </footer>
      </div>
    </>
  );
}

function BuildComplete({
  model,
  configuration,
  user,
}: {
  model: ModelDetail;
  configuration: ProjectConfiguration;
  user: SessionUser;
}) {
  return (
    <div className="projectBuildComplete">
      <span className="projectBuildCompleteMark">✓</span>
      <span className="projectBuildKicker">Маршрут пройден</span>
      <h2>Покажите, что получилось</h2>
      <p>
        {configuration.result} Теперь фотографии и честная оценка помогут следующему человеку выбрать материалы,
        принтер и конфигурацию.
      </p>
      <div className="projectBuildCompleteGrid">
        <button type="button" className="projectBuildAction pressable" onClick={() => navigate(modelPath(model.id, "makes"))}>
          Добавить фото и оценку
          <small>Создать Make для этого проекта</small>
        </button>
        <button type="button" className="projectBuildSecondary pressable" onClick={() => navigate(feedNewPath(model.id))}>
          Опубликовать историю
        </button>
        <button type="button" className="projectBuildSecondary pressable" onClick={() => navigate(profilePath(user.username))}>
          Открыть «Собрано» в профиле
        </button>
      </div>
      <small className="projectBuildPrivacy">Публикация добровольна: прогресс и черновые фото остаются личными.</small>
    </div>
  );
}

function actionableSteps(guide: ProjectBuildGuide | null, model: ModelDetail): ProjectBuildStep[] {
  const fromGuide = (guide?.steps ?? [])
    .filter((step) => !/выбрать конфигурац/i.test(step.title))
    .sort((left, right) => left.position - right.position);
  if (fromGuide.length) return fromGuide;
  return [
    {
      id: `${model.id}-print`,
      position: 1,
      title: "Подготовить и изготовить детали",
      body: "Проверьте выбранную конфигурацию, материал и ориентацию деталей перед запуском.",
      mesh_id: null,
      mesh_object_ref: null,
      parts: [],
      tools: [],
      photos: model.thumb_url
        ? [{ id: `${model.id}-cover`, url: model.thumb_url, position: 1, size_bytes: null, mime_type: null }]
        : [],
    },
    {
      id: `${model.id}-check`,
      position: 2,
      title: "Проверить готовый результат",
      body: "Осмотрите поверхности, размеры и посадки. Если результат отличается от инструкции, зафиксируйте это в Make.",
      mesh_id: null,
      mesh_object_ref: null,
      parts: [],
      tools: [],
      photos: [],
    },
  ];
}

function phaseFor(step: ProjectBuildStep): BuildPhase {
  if (step.phase) return step.phase;
  const value = `${step.title} ${step.body ?? ""}`.toLowerCase();
  if (/печат|слайс|printer|print/.test(value)) return "print";
  if (/код|python|установ|прошив|flash|калибр/.test(value)) return "flash";
  if (/пая|припо|провод|электр|solder/.test(value)) return "solder";
  if (/прове|тест|контрол|check|запуск/.test(value)) return "check";
  return "assembly";
}

function namedEntries(value: unknown): Array<{ name: string; quantity: string | null }> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const record = entry as Record<string, unknown>;
    if (typeof record.name !== "string") return [];
    return [{ name: record.name, quantity: typeof record.quantity === "string" ? record.quantity : null }];
  });
}

function readStoredProgress(key: string): StoredBuildProgress | null {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredBuildProgress>;
    if (!Array.isArray(parsed.doneStepIds) || !parsed.doneStepIds.every((value) => typeof value === "string")) return null;
    return {
      doneStepIds: parsed.doneStepIds,
      currentStepId: typeof parsed.currentStepId === "string" ? parsed.currentStepId : null,
      updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : "",
    };
  } catch {
    return null;
  }
}
