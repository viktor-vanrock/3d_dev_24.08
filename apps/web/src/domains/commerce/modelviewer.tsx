import { useEffect, useRef, useState, type ReactNode } from "react";
import { hueFromId } from "./market.tsx";
import { apiAssetUrl } from "@shared/api";
import { createModelScene, type ModelSceneHandle } from "./modelscene.ts";
import { isMobileViewerProfile } from "./deviceprofile.ts";
import { useOverlay } from "@platform/overlay";
import { Tooltip } from "@shared/ui";

// Вьюер модели (docs/design/marketplace.full.md §12): постер (переиспользует псевдо-3D стек
// .homeModelThumb, теперь с реальной webp-«фоткой» вместо мок-глифа, если она уже готова —
// docs/design/model-preview.md) → тап/скролл-в-вид лениво инициирует three.js-сцену
// (modelscene.ts) → активная сцена с drag-орбитой/зумом/сбросом. Если превью ещё
// нет (параллельная Python-стадия могла не успеть) — только постер + статус.

type ViewerState = "poster" | "loading" | "active" | "error";
const MODEL_LOAD_TIMEOUT_MS = 45_000;

export function ModelViewer({
  modelId,
  title,
  previewUrl,
  previewMobileUrl = null,
  thumbUrl,
  statusOverlay,
  format = "gltf",
  onFullscreenChange,
}: {
  modelId: string;
  // Подпись фулскрина (docs/design/model.card.visual.md §2.2 «приглушённая подпись —
  // название модели» — «чтобы скриншот из фулскрина имел контекст»). Не показывается вне
  // фулскрина — обычный чром карточки уже несёт заголовок в .modelMeta.
  title: string;
  previewUrl: string | null;
  // Облегчённый GLB мобильного профиля (MF-433, apps/mesh preview.py `export_mobile_glb`:
  // ~30k треугольников/1.5МБ вместо десктопных 150k/5МБ). API пока не отдаёт это поле
  // (`preview_mobile_url` — заявка Back, mesh уже льёт объект в S3) — до тех пор проп всегда
  // null и вьюер молча падает на десктопный `previewUrl`, ничего не ломая.
  previewMobileUrl?: string | null;
  thumbUrl: string | null;
  statusOverlay?: ReactNode;
  // "stl" — генерация ветки openscad отдаёт STL напрямую как артефакт, без GLB-превью
  // (GAP-STL, docs/design/generation.md §6.1), а "obj" — fallback RuDALL-E — см. modelscene.ts.
  format?: "gltf" | "stl" | "obj";
  // Полноэкранный вьюер поверх карточки модели переводит шапку в `data-shell="back"`
  // (header.capsule.md § «Четыре режима оболочки», MF-1022) — родитель (model.tsx) сам не
  // знает о fullscreen-состоянии вьюера, узнаёт только через этот колбэк.
  onFullscreenChange?: (fullscreen: boolean) => void;
}) {
  const overlay = useOverlay();
  const [state, setState] = useState<ViewerState>("poster");
  const [loadToken, setLoadToken] = useState(0);
  const [thumbFailed, setThumbFailed] = useState(false);
  // Полноэкранный режим (docs/design/model.card.visual.md §2): `fullscreen` переключает только
  // композицию чрома (см. JSX ниже) — сцена/канвас/камера не пересоздаются, тот же `sceneRef`
  // просто получает resize() от ResizeObserver контейнера. `cssFallback` — iOS Safari не даёт
  // requestFullscreen() на <div> (§2.4), тогда полноэкранность имитируется CSS
  // position:fixed;inset:0 — визуально неотличимо от реального фулскрина (тот же [data-fullscreen]).
  const [fullscreen, setFullscreen] = useState(false);
  const [cssFallback, setCssFallback] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<ModelSceneHandle | null>(null);
  const fullscreenRef = useRef(false);
  const historyPushedRef = useRef(false);
  const mobileProfile = isMobileViewerProfile();
  const effectivePreviewUrl = (mobileProfile && previewMobileUrl) || previewUrl;
  const previewSrc = effectivePreviewUrl ? apiAssetUrl(effectivePreviewUrl) : null;
  const sceneKey = `${modelId}\u0000${previewSrc ?? ""}\u0000${format}\u0000${mobileProfile ? "mobile" : "desktop"}`;
  const requestedSceneKeyRef = useRef("");

  useEffect(() => {
    setThumbFailed(false);
  }, [modelId, thumbUrl]);

  useEffect(() => {
    requestedSceneKeyRef.current = "";
    setState("poster");
  }, [sceneKey]);

  useEffect(() => {
    fullscreenRef.current = fullscreen;
    onFullscreenChange?.(fullscreen);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onFullscreenChange не тянет пересоздание эффекта
  }, [fullscreen]);

  function start() {
    if (!previewSrc) return;
    requestedSceneKeyRef.current = sceneKey;
    setState("loading");
    setLoadToken((current) => current + 1);
  }

  // Выход из фулскрина (§2.4): единая точка для всех четырёх путей (Esc/×/history-popstate/
  // fullscreenchange) — не дублируем cleanup четыре раза. Если мы сами толкнули запись истории
  // при входе, оставляем закрытию отработать через history.back() (см. requestExitFullscreen),
  // а не мутируем историю второй раз здесь.
  function closeFullscreen() {
    historyPushedRef.current = false;
    setFullscreen(false);
    setCssFallback(false);
    if (document.fullscreenElement === containerRef.current) {
      void document.exitFullscreen().catch(() => {});
    }
  }

  function requestExitFullscreen() {
    if (historyPushedRef.current) {
      window.history.back();
    } else {
      closeFullscreen();
    }
  }

  function enterFullscreen() {
    if (state !== "active" || fullscreen) return;
    historyPushedRef.current = true;
    window.history.pushState({ modelFullscreen: true }, "");
    const el = containerRef.current;
    const canRequest = !!el && typeof el.requestFullscreen === "function" && document.fullscreenEnabled !== false;
    setFullscreen(true);
    if (canRequest) {
      el!.requestFullscreen().catch(() => setCssFallback(true));
    } else {
      setCssFallback(true);
    }
  }

  // Путь выхода: history-popstate (назад/жест на мобильном) — если запись, которую мы толкнули
  // при входе, уже смыта (мы её же и наблюдаем через сам факт popstate), просто закрываем.
  useEffect(() => {
    function onPopState() {
      if (historyPushedRef.current) closeFullscreen();
    }
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  // Путь выхода: fullscreenchange (браузер сам вышел — например, системный жест/Esc в реальном
  // фулскрине). CSS-фолбэк не порождает это событие, там exit идёт только через Esc-keydown ниже.
  useEffect(() => {
    function onFsChange() {
      if (!document.fullscreenElement && fullscreenRef.current) requestExitFullscreen();
    }
    document.addEventListener("fullscreenchange", onFsChange);
    return () => document.removeEventListener("fullscreenchange", onFsChange);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- читает fullscreenRef, не fullscreen напрямую
  }, []);

  // Путь выхода: Esc — нужен явно только для CSS-фолбэка (реальный фулскрин обрабатывает Esc
  // сам и уже покрыт fullscreenchange выше); держим слушатель общим — closeFullscreen идемпотентен.
  useEffect(() => {
    if (!fullscreen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") requestExitFullscreen();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fullscreen]);

  // На случай смены/размонтирования карточки посреди реального фулскрина — не оставляем браузер
  // залипшим в чужом фулскрине.
  useEffect(() => {
    const container = containerRef.current;
    return () => {
      if (document.fullscreenElement === container) void document.exitFullscreen().catch(() => {});
    };
  }, []);

  useEffect(() => {
    if (
      state !== "loading" ||
      !previewSrc ||
      requestedSceneKeyRef.current !== sceneKey
    ) {
      return;
    }
    const canvas = canvasRef.current;
    if (!canvas) return;
    let cancelled = false;
    let handle: ModelSceneHandle | null = null;
    const timeout = window.setTimeout(() => fail(), MODEL_LOAD_TIMEOUT_MS);

    function fail() {
      if (cancelled) return;
      window.clearTimeout(timeout);
      handle?.dispose();
      if (sceneRef.current === handle) sceneRef.current = null;
      if (requestedSceneKeyRef.current !== sceneKey) return;
      // Потеря сцены/WebGL в фулскрине (§2.4): выходим из фулскрина и честно говорим, а не
      // оставляем чёрный экран — обычный state==="error" (с «Повторить») ниже отрабатывает
      // как и вне фулскрина.
      if (fullscreenRef.current) {
        closeFullscreen();
        overlay.toast({ severity: "critical", title: "Не удалось показать модель" });
      }
      setState("error");
    }

    try {
      handle = createModelScene(
        canvas,
        previewSrc,
        {
          onLoaded: () => {
            if (
              cancelled ||
              requestedSceneKeyRef.current !== sceneKey
            ) {
              return;
            }
            window.clearTimeout(timeout);
            setState("active");
          },
          onError: fail,
        },
        format,
        mobileProfile,
      );
      sceneRef.current = handle;
    } catch {
      fail();
    }
    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
      handle?.dispose();
      if (sceneRef.current === handle) sceneRef.current = null;
    };
    // `state` намеренно не dependency: переход loading→active НЕ должен уничтожать
    // только что загруженную Three.js-сцену. Новый запуск задаётся loadToken, а смена
    // модели — sceneKey.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadToken, sceneKey]);

  // Лениво инициируем при скролле карточки в область видимости
  useEffect(() => {
    if (!previewSrc || state !== "poster") return;
    const el = containerRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) start();
      },
      { threshold: 0.4 },
    );
    observer.observe(el);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewSrc, state]);

  useEffect(() => {
    if (state !== "active") return;
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => sceneRef.current?.resize());
    observer.observe(el);
    return () => observer.disconnect();
  }, [state]);

  const hue = hueFromId(modelId);
  const visibleThumbUrl = thumbUrl && !thumbFailed ? thumbUrl : null;

  return (
    <div
      className="modelViewerStage"
      ref={containerRef}
      style={{ ["--tile-hue" as string]: hue }}
      data-fullscreen={fullscreen || undefined}
      data-fullscreen-fallback={cssFallback || undefined}
    >
      <div className="modelViewerPoster" data-hidden={state === "active" || undefined}>
        <span className="homeModelThumb" style={{ position: "absolute", inset: 0 }}>
          <span className="homeModelGlow" aria-hidden="true" />
          <span
            className={`homeModelArt${visibleThumbUrl ? " homeModelArt--photo" : " modelViewerFallbackArt"}`}
          >
            <span className="homeModelLayer homeModelLayerBack" aria-hidden="true">
              {visibleThumbUrl ? (
                <img className="homeModelPhoto" src={apiAssetUrl(visibleThumbUrl)} alt="" onError={() => setThumbFailed(true)} />
              ) : (
                <CubeIcon />
              )}
            </span>
            <span className="homeModelLayer homeModelLayerFront">
              {visibleThumbUrl ? (
                <img className="homeModelPhoto" src={apiAssetUrl(visibleThumbUrl)} alt="" onError={() => setThumbFailed(true)} />
              ) : (
                <CubeIcon />
              )}
            </span>
          </span>
          <span className="homeModelShadow" aria-hidden="true" />
        </span>
      </div>

      {previewSrc && (state === "loading" || state === "active") ? (
        <canvas ref={canvasRef} className="modelViewerCanvas" data-visible={state === "active" || undefined} />
      ) : null}

      {state === "poster" && previewSrc ? (
        <button type="button" className="modelViewerAffordance modelGlassBtn pressable" onClick={start}>
          <RotateIcon /> Покрутить
        </button>
      ) : null}

      {state === "loading" ? <div className="modelViewerLoading">Загружаем 3D…</div> : null}

      {state === "error" ? (
        <div className="modelViewerError">
          <span>Не удалось загрузить превью</span>
          <button type="button" className="modelGlassBtn pressable" onClick={start}>
            Повторить
          </button>
        </div>
      ) : null}

      {state === "active" && !fullscreen ? (
        <>
          <Tooltip content="Открыть 3D-модель на весь экран">
            <button
              type="button"
              className="modelViewerFullscreenBtn modelGlassBtn pressable"
              aria-label="Открыть 3D-модель на весь экран"
              onClick={enterFullscreen}
            >
              <ExpandIcon />
            </button>
          </Tooltip>
          <Tooltip content="Вернуть исходное положение 3D-модели">
            <button
              type="button"
              className="modelViewerReset modelGlassBtn pressable"
              aria-label="Вернуть исходное положение 3D-модели"
              onClick={() => sceneRef.current?.reset()}
            >
              <ResetIcon />
            </button>
          </Tooltip>
        </>
      ) : null}

      {statusOverlay && state !== "active" && !fullscreen ? <div className="modelViewerStatusOverlay">{statusOverlay}</div> : null}

      {fullscreen ? (
        <div className="modelViewerFsChrome">
          <span className="modelViewerFsTitle">{title}</span>
          <div className="modelViewerFsActions">
            <Tooltip content="Вернуть исходное положение 3D-модели">
              <button
                type="button"
                className="modelViewerFsBtn modelGlassBtn pressable"
                aria-label="Вернуть исходное положение 3D-модели"
                onClick={() => sceneRef.current?.reset()}
              >
                <ResetIcon />
              </button>
            </Tooltip>
            <Tooltip content="Закрыть полноэкранный режим">
              <button
                type="button"
                className="modelViewerFsBtn modelGlassBtn pressable"
                aria-label="Закрыть полноэкранный режим"
                onClick={requestExitFullscreen}
              >
                <CloseIcon />
              </button>
            </Tooltip>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function CubeIcon() {
  return (
    <svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M12 3l8 4.5v9L12 21l-8-4.5v-9L12 3Zm0 0v9m0 9v-9m0 0L4 7.5M12 12l8-4.5"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function RotateIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M4 12a8 8 0 0 1 14-5.2M20 12a8 8 0 0 1-14 5.2"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <path d="M18 3v4h-4M6 21v-4h4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ResetIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M4 12a8 8 0 1 1 3 6.3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M4 18v-5h5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// Глиф «expand» (docs/design/model.card.visual.md §2.1): четыре угла-скобки к центру, line ~2px,
// без заливки — тот же язык, что Reset/Rotate рядом.
function ExpandIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M9 4H4v5M15 4h5v5M9 20H4v-5M15 20h5v-5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M6 6l12 12M18 6 6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
