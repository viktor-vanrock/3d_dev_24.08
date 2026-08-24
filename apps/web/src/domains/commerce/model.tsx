import { useEffect, useRef, useState } from "react";
import type { SessionUser } from "@shared/types";
// eslint-disable-next-line boundaries/element-types -- легатное междоменное ребро (микроэтап 7.6): рантайм-зависимость, не тип/utility; развязка отложена до pages/DI-этапа. См. apps/web/MIGRATION.md.
import { useGuestLogin, HoneypotLink } from "@domains/access";
// eslint-disable-next-line boundaries/element-types -- легатное междоменное ребро (микроэтап 7.6): рантайм-зависимость, не тип/utility; развязка отложена до pages/DI-этапа. См. apps/web/MIGRATION.md.
import { VoteArrows } from "@domains/social";
import { useActivation } from "@shared/lib";
import { HomeHeader, type Section } from "@platform/nav";
// eslint-disable-next-line boundaries/element-types, boundaries/entry-point -- легатное ребро (Этап 4.5): CSS side-effect, не index.ts; home.css остаётся общим "рабочим хромом" для доменных экранов, развязка отложена до pages/DI (Этап 10). См. MIGRATION.md.
import "@pages/home/home.css";
import { useOverlay } from "@platform/overlay";
import { AuroraBackground, Chip, CubeIcon, EmptyState, Eyebrow, Heading, PrinterIcon, StatusPill, Tooltip } from "@shared/ui";
import {
  headerModeFor,
  makePath,
  marketPath,
  marketTagPath,
  type ModelTab,
  modelPath,
  navigate,
  profilePath,
  projectBuildPath,
} from "../../router.ts";
import { AddModelFlow } from "./addmodel.tsx";
import { getProjectBuildGuide, type ProjectBuildGuide } from "./buildguide.ts";
import { ModelCompatBadges } from "./compatbadge.tsx";
import { ContextFeedbackDoor } from "./contextfeedback.tsx";
import { CreateMakeFlow } from "./createmake.tsx";
import { demoProjectDownloadsFor, isDemoProjectId } from "./demoproject.ts";
import "./market.css";
import { MarkdownBody } from "./markdown.tsx";
import { relativeDate, STATUS_META } from "./market.tsx";
import { DownloadIcon, formatBbox, formatBytes, ForkIcon, ShareIcon } from "./model.icons.tsx";
import "./model.css";
import { CraftBadge } from "./craft.tsx";
import { ModelSocialTabs } from "./model.stats.tsx";
import { ProjectLaunchpad } from "./projectlaunchpad.tsx";
import { ProjectManifestEditor } from "./projectmanifest.tsx";
import {
  deleteModel,
  fileDownloadUrl,
  forkModel,
  getModel,
  getModelHistory,
  getModelTree,
  triggerBrowserDownload,
  updateModel,
  type ModelDetail,
  type ProjectFile,
  type RecommendedMaterial,
  type RepoHistoryCommit,
  type RepoTreeResult,
} from "./models.ts";
import { apiAssetUrl } from "@shared/api";
import { ModelViewer } from "./modelviewer.tsx";
import { groupFilesByRole, ProjectFiles, shouldShowProjectFiles } from "./projectfiles.tsx";
import { RepoHistory } from "./repohistory.tsx";
import { PurchaseAction } from "./purchases.tsx";

// Страница модели (MF-463, docs/design/marketplace.full.md §5, v2 §2 «floating»): без
// карточки под текстом — только стекло на интерактиве (вьюер-чром, голос, скачать,
// owner-actions). Полинг статуса, пока модель не 'ready'/'failed' (без websocket).
// Соцвкладки (обсуждение/напечатали/статистика) — model.stats.tsx; иконки/форматтеры —
// model.icons.tsx (MF-911, разбиение файла по функциональным секциям).

const POLL_INTERVAL_MS = 4000;

export function ModelScreen({
  user,
  section,
  onSectionChange,
  id,
  tab,
}: {
  // Гость читает карточку модели без входа (MF-850/MF-912, marketplace.full.md §5.2/5.3,
  // model.card.v3.md §4.4): голос/скачивание/форк/коммент ниже сами проверяют user и уходят
  // в overlay-промпт входа (useGuestLogin) вместо тихого 401.
  user: SessionUser | null;
  section: Section;
  onSectionChange: (section: Section) => void;
  id: string;
  tab?: ModelTab;
}) {
  const overlay = useOverlay();
  const promptGuestLogin = useGuestLogin();
  // Парк ЛК (MF-15) ТЕКУЩЕГО зрителя — не владельца модели, у бейджа совместимости (MF-410)
  // свой парк на каждого посетителя, поэтому хук вызывается здесь, а не читается из props.
  const activation = useActivation();
  const [model, setModel] = useState<ModelDetail | null | undefined>(undefined);
  // Полноэкранный 3D-вьюер поверх карточки модели → шапка `demo` (header.capsule.md §
  // «Четыре режима оболочки», MF-1022) — читается из колбэка ModelViewer, не дублирует
  // состояние fullscreen внутри самого вьюера.
  const [viewerFullscreen, setViewerFullscreen] = useState(false);
  const [forking, setForking] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [tree, setTree] = useState<RepoTreeResult | null>(null);
  const [history, setHistory] = useState<RepoHistoryCommit[]>([]);
  const [buildGuide, setBuildGuide] = useState<ProjectBuildGuide | null>(null);
  const modelRef = useRef<ModelDetail | null | undefined>(model);
  modelRef.current = model;

  useEffect(() => {
    let cancelled = false;
    setModel(undefined);
    void getModel(id).then((result) => {
      if (!cancelled) setModel(result);
    });
    return () => {
      cancelled = true;
    };
  }, [id]);

  // Дерево файлов + история (docs/design/projects.page.md §11, MF-522) — независимые от
  // README/primary-скачивания запросы (§11.5: сбой дерева/истории не блокирует страницу).
  useEffect(() => {
    let cancelled = false;
    setTree(null);
    setHistory([]);
    setBuildGuide(null);
    // У отсутствующего проекта остаётся только empty-state: не создаём три 404 в console/network
    // запросами к производным данным. При смене id ждём подтверждённую модель нового маршрута.
    const current = modelRef.current;
    if (!current || current.id !== id) return () => {
      cancelled = true;
    };
    void getModelTree(id).then((result) => {
      if (!cancelled) setTree(result);
    });
    void getModelHistory(id).then((result) => {
      if (!cancelled) setHistory(result?.commits ?? []);
    });
    void getProjectBuildGuide(id).then((result) => {
      if (!cancelled) setBuildGuide(result);
    });
    return () => {
      cancelled = true;
    };
  }, [id, model?.id]);

  useEffect(() => {
    const current = modelRef.current;
    if (!current || current.status === "ready" || current.status === "failed") return;
    const interval = setInterval(() => {
      void getModel(id).then((result) => {
        if (result) setModel(result);
      });
    }, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [id, model?.status]);

  function openEdit() {
    const current = modelRef.current;
    if (!current) return;
    const handle = overlay.modal({
      title: "Редактировать проект",
      size: "wide",
      content: (
        <AddModelFlow
          overlay={overlay}
          mode="edit"
          model={{
            id: current.id,
            title: current.title,
            description: current.description,
            tags: current.tags,
            repo_url: current.repo_url,
            recommended_material: current.recommended_material
              ? {
                  id: current.recommended_material.id,
                  name: current.recommended_material.name,
                  brand: current.recommended_material.vendor.name,
                }
              : null,
            auxFiles: current.files
              .filter((f) => f.role === "aux" && f.original_filename)
              .map((f) => ({
                id: f.id,
                role: "aux" as const,
                original_filename: f.original_filename!,
                mime_type: null,
                size_bytes: f.size_bytes,
              })),
          }}
          onClose={() => handle.close()}
          onSaved={() => {
            handle.close();
            overlay.toast({ severity: "success", title: "Изменения сохранены" });
            void getModel(id).then((result) => {
              if (result) setModel(result);
            });
          }}
        />
      ),
    });
  }

  function openProjectSettings() {
    const current = modelRef.current;
    if (!current) return;
    const handle = overlay.modal({
      title: "Состав и варианты проекта",
      size: "wide",
      content: <ProjectManifestEditor modelId={current.id} onClose={() => handle.close()} />,
    });
  }

  function openMakeFlow() {
    const current = modelRef.current;
    if (!current) return;
    if (!user) {
      promptGuestLogin();
      return;
    }
    const handle = overlay.modal({
      title: "Добавить результат",
      size: "wide",
      content: (
        <CreateMakeFlow
          modelId={current.id}
          modelTitle={current.title}
          onClose={() => handle.close()}
          onCreated={(makeId) => {
            handle.close();
            overlay.toast({ severity: "success", title: "Печать опубликована" });
            void getModel(id).then((result) => {
              if (result) setModel(result);
            });
            navigate(makePath(makeId));
          }}
        />
      ),
    });
  }

  async function handleDelete() {
    const current = modelRef.current;
    if (!current) return;
    const confirmed = await overlay.confirm({
      severity: "critical",
      title: "Удалить проект?",
      message: "Файл и карточка исчезнут без возможности восстановления.",
      confirmLabel: "Удалить",
      cancelLabel: "Отмена",
      destructive: true,
    });
    if (!confirmed) return;
    const ok = await deleteModel(current.id);
    if (!ok) {
      overlay.toast({ severity: "critical", title: "Не удалось удалить проект" });
      return;
    }
    navigate(marketPath());
  }

  // Публикация/распубликация (MF-340/MF-341): отдельное поле `publish_status` на `models`,
  // не путать с конвейерным `status` выше. Черновик виден только владельцу (гейт —
  // apps/api/src/models/visibility.ts); ownership_not_verified (импортированный черновик без
  // подтверждения владения, MF-37 § 6) — единственная ожидаемая 403-причина отказа публикации.
  async function handleTogglePublish() {
    const current = modelRef.current;
    if (!current || publishing) return;
    const nextStatus = current.publish_status === "published" ? "draft" : "published";
    setPublishing(true);
    const ok = await updateModel(current.id, { publish_status: nextStatus });
    setPublishing(false);
    if (!ok) {
      overlay.toast({
        severity: "critical",
        title: nextStatus === "published" ? "Не удалось опубликовать" : "Не удалось снять с публикации",
        message: nextStatus === "published" ? "Владение источником ещё не подтверждено." : undefined,
      });
      return;
    }
    setModel((prev) => (prev ? { ...prev, publish_status: nextStatus } : prev));
    overlay.toast({
      severity: "success",
      title: nextStatus === "published" ? "Проект опубликован" : "Проект снят с публикации",
    });
  }

  // Скачивание артефактов блока «Файлы проекта» — как есть, без конвертации (projects.md §3.2,
  // MF-656). canonical_3mf идёт через отдельный /download.3mf (тот же download_url, что и
  // DownloadButton), остальные роли-артефакты — через общий /files/:role/download. 'source'
  // Back не отдаёт вовсе (докрытие «исходник наружу никогда не течёт», docs/epics/3mf.storage.md) —
  // честно объясняем, а не бьём в мёртвую ссылку. По роли (не по ProjectFile) — тот же путь нужен
  // и дереву репо (§11.2 projects.page.md, RepoTree в projectfiles.tsx), где под рукой только role.
  function downloadByRole(role: string) {
    const current = modelRef.current;
    if (!current) return;
    // Гость жмёт «Скачать» → промпт входа поверх, не тихий 401 (marketplace.full.md §5.3):
    // скачивание запускается само после логина (guestintent.ts/guestresume.tsx).
    if (!user) {
      promptGuestLogin({ kind: "download", modelId: current.id, role, returnTo: modelPath(current.id) });
      return;
    }
    if (isDemoProjectId(current.id)) {
      const url = demoProjectDownloadsFor(current.id)[role];
      if (url) triggerBrowserDownload(url);
      else overlay.toast({ severity: "info", title: "Для этого демо-файла пока нет прямой ссылки" });
      return;
    }
    if (role === "source") {
      overlay.toast({
        severity: "info",
        title: "Исходник не отдаётся отдельно",
        message: "Скачайте готовый файл кнопкой «Скачать 3MF».",
      });
      return;
    }
    if (role === "canonical_3mf") {
      if (current.download_url) triggerBrowserDownload(apiAssetUrl(current.download_url));
      return;
    }
    triggerBrowserDownload(fileDownloadUrl(current.id, role));
  }

  function handleDownloadArtifact(file: ProjectFile) {
    downloadByRole(file.role);
  }

  // Форк (docs/design/projects.page.md §11.4, docs/epics/project.git.md §3.4): server-side
  // clone → редирект на новую копию-проект. Эндпоинт POST /models/:id/fork ещё не задеплоен
  // Back'ом (заявка в карточке MF-522) — при отсутствии/ошибке честный тост, не тихий провал.
  async function handleFork() {
    const current = modelRef.current;
    if (!current || forking) return;
    // Гость жмёт «Форк» → промпт входа поверх (projects.page.md §11.4): форк создаётся
    // сам после логина и открывается (guestintent.ts/guestresume.tsx).
    if (!user) {
      promptGuestLogin({ kind: "fork", modelId: current.id, returnTo: modelPath(current.id) });
      return;
    }
    setForking(true);
    const result = await forkModel(current.id);
    setForking(false);
    if (!result) {
      overlay.toast({
        severity: "critical",
        title: "Не удалось создать копию",
        message: "Попробуйте ещё раз чуть позже.",
      });
      return;
    }
    navigate(modelPath(result.id));
  }

  // «Скачать весь проект одним действием» (docs/design/projects.multiformat.md §0 п.5, MVP):
  // запускает скачивание каждого артефакта блока по очереди. 'source' в комплект не входит —
  // Back его не отдаёт (см. handleDownloadArtifact).
  function handleDownloadAll() {
    const current = modelRef.current;
    if (!current) return;
    // Гость: тот же промпт, что и одиночная кнопка — «скачать всё» доиграет только первый
    // (canonical_3mf) файл после логина, остальные докачивает вручную повторным тапом.
    if (!user) {
      promptGuestLogin({ kind: "download", modelId: current.id, role: "canonical_3mf", returnTo: modelPath(current.id) });
      return;
    }
    if (isDemoProjectId(current.id)) {
      for (const url of new Set(Object.values(demoProjectDownloadsFor(current.id)))) triggerBrowserDownload(url);
      return;
    }
    const shown = groupFilesByRole(current.files).flatMap((group) => group.files);
    if (shown.some((file) => file.role === "canonical_3mf") && current.download_url) {
      triggerBrowserDownload(apiAssetUrl(current.download_url));
    }
    for (const file of shown) {
      if (file.role === "canonical_3mf" || file.role === "source") continue;
      triggerBrowserDownload(fileDownloadUrl(current.id, file.role));
    }
    if (shown.some((file) => file.role === "source")) {
      overlay.toast({
        severity: "info",
        title: "Исходник не входит в комплект",
        message: "Он не отдаётся отдельно — в комплекте уже есть готовый 3MF.",
      });
    }
  }

  // «Поделиться» (v2 §3.3): Web Share, фолбэк — копия ссылки в буфер + тост. Отказ пользователя
  // от системного шита (AbortError и т.п.) — не ошибка, тихо игнорируем.
  async function handleShare() {
    const current = modelRef.current;
    if (!current) return;
    const url = new URL(modelPath(current.id), window.location.origin).toString();
    if (typeof navigator.share === "function") {
      try {
        await navigator.share({ title: current.title, url });
      } catch {
        // отказ/отмена шита — тихо
      }
      return;
    }
    try {
      await navigator.clipboard.writeText(url);
      overlay.toast({ severity: "success", title: "Ссылка скопирована" });
    } catch {
      overlay.toast({ severity: "info", title: "Скопируйте ссылку из адресной строки" });
    }
  }

  const mine = model ? model.owner.id === user?.id : false;

  return (
    <div className="home">
      <AuroraBackground />
      <div style={{ position: "relative", zIndex: 30 }}>
        <HomeHeader
          user={user}
          printers={[]}
          section={section}
          onSectionChange={onSectionChange}
          onBack={() => navigate(marketPath())}
          mode={headerModeFor("model", { viewerFullscreen, withBack: true })}
        />
      </div>
      <main className="homeContent homeWorkspaceBody modelPageBody">
        <HoneypotLink />
        {model === undefined ? null : model === null ? (
          <div className="modelNotFound">
            <EmptyState
              icon={<CubeIcon />}
              title="Проект не найден"
              sub="Возможно, он был удалён или ещё не опубликован."
              action={
                <div className="cfbEmptyActions">
                  <button type="button" className="modelGlassBtn pressable" onClick={() => navigate(marketPath())}>
                    В каталог
                  </button>
                  <ContextFeedbackDoor preset="problem" context={{ title: "Битая ссылка на проект", ref: { type: "broken_link", id } }} />
                </div>
              }
            />
          </div>
        ) : (
          <>
            <div className="modelHero">
              <ModelViewer
                modelId={model.id}
                title={model.title}
                previewUrl={model.preview_url}
                previewMobileUrl={model.preview_mobile_url ?? null}
                thumbUrl={model.thumb_url}
                format={isDemoProjectId(model.id) ? "stl" : "gltf"}
                statusOverlay={
                  STATUS_META[model.status] ? (
                    <StatusPill tone={STATUS_META[model.status]!.tone} pulse={STATUS_META[model.status]!.pulse}>
                      {STATUS_META[model.status]!.label}
                    </StatusPill>
                  ) : undefined
                }
                onFullscreenChange={setViewerFullscreen}
              />

              <div className="modelMeta">
                <div className="modelEyebrowRow">
                  <CraftBadge craft={model.craft} />
                  <Eyebrow>{model.source_format.toUpperCase()}</Eyebrow>
                  {STATUS_META[model.status] ? (
                    <StatusPill tone={STATUS_META[model.status]!.tone} pulse={STATUS_META[model.status]!.pulse}>
                      {STATUS_META[model.status]!.label}
                    </StatusPill>
                  ) : null}
                  {mine && model.publish_status === "draft" ? <StatusPill tone="dim">Черновик</StatusPill> : null}
                </div>

                <Heading size="md">{model.title}</Heading>

                <button
                  type="button"
                  className="modelAuthorLink pressable"
                  style={{ minHeight: "var(--touch-target-min)" }}
                  data-touch-target="48"
                  onClick={() => navigate(profilePath(model.owner.username))}
                >
                  @{model.owner.username}
                  {model.owner.trusted_uploader ? (
                    <span role="status" aria-label="доверенный вкладчик">
                      <StatusPill tone="ok" level={2}>доверенный вкладчик</StatusPill>
                    </span>
                  ) : null}
                </button>

                <div className="modelDownloadRow">
                  <VoteArrows
                    user={user}
                    subjectType="model"
                    subjectId={model.id}
                    votesUp={model.votes_up}
                    votesDown={model.votes_down}
                    myVote={model.my_vote}
                    onVoted={(result) =>
                      setModel((prev) =>
                        prev ? { ...prev, votes_up: result.votes_up, votes_down: result.votes_down, my_vote: result.my_vote } : prev,
                      )
                    }
                  />

                  {model.status === "ready" && model.download_url ? (
                    <PurchaseAction
                      modelId={model.id}
                      priceMinor={model.price_minor ?? 0}
                      currency={model.currency ?? "RUB"}
                      purchased={model.purchased ?? model.price_minor === 0}
                      downloadLabel={isDemoProjectId(model.id) ? "Скачать STL" : undefined}
                      onDownload={() => downloadByRole("canonical_3mf")}
                    />
                  ) : (
                    <DownloadButton model={model} mine={mine} onDownload={() => downloadByRole("canonical_3mf")} />
                  )}
                </div>

                <div className="modelActionRow">
                  <button
                    type="button"
                    className="modelGlassBtn modelPrintBtn pressable"
                    onClick={() => document.getElementById("project-launchpad-title")?.scrollIntoView({ behavior: "smooth", block: "start" })}
                  >
                    <PrinterIcon size={18} />
                    <span>Выбрать сборку</span>
                  </button>
                  <button type="button" className="modelGlassBtn pressable" onClick={() => void handleShare()}>
                    <ShareIcon />
                    Поделиться
                  </button>
                  <Tooltip content="Создать свою копию проекта для доработки">
                    <button
                      type="button"
                      className="modelGlassBtn pressable"
                      disabled={forking}
                      onClick={() => void handleFork()}
                    >
                      <ForkIcon />
                      {forking ? "Создаём копию…" : "Сделать копию проекта"}
                    </button>
                  </Tooltip>
                  <button type="button" className="modelGlassBtn modelMakeBtn pressable" onClick={openMakeFlow}>
                    <MakePhotoIcon />
                    Я сделал это
                  </button>
                </div>

                <div className="modelDescription" data-empty={!model.description || undefined}>
                  {model.description ? <MarkdownBody source={model.description} /> : "Автор пока не добавил описание."}
                </div>

                {model.tags.length > 0 ? (
                  <div className="modelTagRow">
                    {model.tags.map((tag) => (
                      <Chip key={tag} onClick={() => navigate(marketTagPath(tag))}>
                        {tag}
                      </Chip>
                    ))}
                  </div>
                ) : null}

                <ModelCompatBadges modelId={model.id} printers={activation.printers} />

                {mine ? (
                  <div className="modelOwnerActions">
                    <button type="button" className="modelGlassBtn pressable" onClick={openEdit}>
                      Редактировать
                    </button>
                    <button type="button" className="modelGlassBtn pressable" onClick={openProjectSettings}>
                      Состав и варианты
                    </button>
                    <button
                      type="button"
                      className="modelGlassBtn pressable"
                      disabled={publishing}
                      onClick={() => void handleTogglePublish()}
                    >
                      {model.publish_status === "published" ? "Снять с публикации" : "Опубликовать"}
                    </button>
                    <button type="button" className="modelGlassBtn pressable" data-danger onClick={() => void handleDelete()}>
                      Удалить
                    </button>
                  </div>
                ) : null}
              </div>
            </div>

            <ProjectLaunchpad
              model={model}
              onStart={(configurationId) => {
                if (!user) {
                  promptGuestLogin();
                  return;
                }
                navigate(projectBuildPath(model.id, configurationId));
              }}
            />

            <section className="modelProjectKit" aria-label="Комплект проекта">
              <div className="modelProjectKitMain">
                <div className="modelSectionIntro">
                  <Eyebrow>Комплект проекта</Eyebrow>
                  <h2>Всё, что понадобится для результата</h2>
                  <p>Файлы, исходники и история изменений собраны рядом с инструкцией.</p>
                </div>
                <ProjectFiles
                  files={model.files}
                  repoUrl={model.repo_url}
                  tree={tree}
                  onDownload={handleDownloadArtifact}
                  onDownloadByRole={downloadByRole}
                  // «Скачать весь проект» имеет смысл только когда есть реальные файлы-артефакты —
                  // репо-ссылка-в-одиночку (§4.2) даёт лишь «Открыть», нечего архивировать.
                  onDownloadAll={shouldShowProjectFiles(model.files) ? handleDownloadAll : undefined}
                />
                <RepoHistory commits={history} owner={model.owner} relativeDate={relativeDate} />
              </div>

              <aside className="modelProjectFacts" aria-label="Параметры проекта">
                <Eyebrow>Паспорт проекта</Eyebrow>
                <div className="modelSpecs">
                  <SpecRow label="Формат" value={model.source_format.toUpperCase()} />
                  {formatBbox(model.bbox) ? <SpecRow label="Габариты" value={formatBbox(model.bbox)!} /> : null}
                  {model.size_bytes ? <SpecRow label="Размер" value={formatBytes(model.size_bytes)} /> : null}
                  <SpecRow label="Загружено" value={relativeDate(model.created_at)} />
                  {model.recommended_material ? (
                    <SpecRow label="Материал" value={recommendedMaterialLabel(model.recommended_material)} />
                  ) : null}
                  <SpecRow label="Сценарий" value={buildGuide?.steps.length ? "Сборка по шагам" : "Готово к печати"} />
                </div>
              </aside>
            </section>

            <ModelSocialTabs
              model={model}
              activeTab={tab}
              mine={mine}
              userId={user?.id ?? null}
              onGuestComment={promptGuestLogin}
              onAddMake={openMakeFlow}
            />

            <div className="modelFeedbackFooter">
              <ContextFeedbackDoor
                preset="problem"
                context={{ category: "catalog", ref: { type: "model", id: model.id, title: model.title } }}
              />
            </div>
          </>
        )}
      </main>
    </div>
  );
}

// Тот же приём дедупа бренда, что addmodel.tsx::materialLabel/home/printerpicker.tsx::printerLabel.
function recommendedMaterialLabel(material: RecommendedMaterial): string {
  if (material.vendor.name && material.name.toLowerCase().includes(material.vendor.name.toLowerCase())) return material.name;
  return `${material.vendor.name} ${material.name}`.trim();
}

function SpecRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="modelSpecRow">
      <span className="modelSpecLabel">{label}</span>
      <span className="modelSpecValue">{value}</span>
    </div>
  );
}

function MakePhotoIcon() {
  return (
    <svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="3.5" y="5" width="17" height="14" rx="3" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="9" cy="10" r="1.7" stroke="currentColor" strokeWidth="1.6" />
      <path d="m5.5 17 4.2-4 2.8 2.5 2.2-2 3.8 3.5" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  );
}

function DownloadButton({ model, mine, onDownload }: { model: ModelDetail; mine: boolean; onDownload: () => void }) {
  const overlay = useOverlay();

  if (model.status === "failed") {
    if (!mine) return null;
    return (
      <button
        type="button"
        className="modelGlassBtn modelDownloadBtn pressable"
        data-tone="disabled"
        onClick={() => overlay.toast({ severity: "info", title: "Повтор обработки скоро появится" })}
      >
        Повторить обработку
      </button>
    );
  }
  if (model.status === "processing") {
    return (
      <button type="button" className="modelGlassBtn modelDownloadBtn pressable" data-tone="processing" disabled>
        Конвертация…
      </button>
    );
  }
  if (model.status !== "ready") {
    return (
      <button type="button" className="modelGlassBtn modelDownloadBtn pressable" data-tone="disabled" disabled>
        В очереди
      </button>
    );
  }
  if (!model.download_url) {
    // Не должно случаться при status='ready' (canonical_3mf гарантирован тем же условием на
    // Back), но защищаемся честно, а не мёртвой ссылкой.
    return (
      <button
        type="button"
        className="modelGlassBtn modelDownloadBtn pressable"
        data-tone="disabled"
        onClick={() => overlay.toast({ severity: "info", title: "Скачивание скоро появится" })}
      >
        <DownloadIcon /> Скачать 3MF
      </button>
    );
  }
  return (
    // Кнопка, не голый <a href> (было): гостя нужно перехватить промптом входа ДО запроса
    // (marketplace.full.md §5.3) — downloadByRole/model.tsx решает, слать реальную ссылку
    // или открыть overlay-логин, `<a>` этого решения не знает.
    <button type="button" className="modelGlassBtn modelDownloadBtn pressable" data-tone="active" onClick={onDownload}>
      <DownloadIcon /> Скачать 3MF
    </button>
  );
}
