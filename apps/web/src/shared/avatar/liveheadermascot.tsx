import { useEffect, useRef, useState } from "react";
import { AvatarBubble, type AvatarConfig, type AvatarSnapshots } from "./avatar.tsx";
import { HEADER_MASCOT_REST_POINTER, headerMascotPointerForCursor } from "./headermascotpose.ts";
import type { HeaderMascotSceneHandle } from "./mascot3d.ts";

type MascotModule = typeof import("./mascot3d.ts");

interface NetworkInformationLike {
  saveData?: boolean;
}

interface NavigatorWithHints extends Navigator {
  connection?: NetworkInformationLike;
  deviceMemory?: number;
}

// HomeHeader сегодня живёт внутри экранов и перемонтируется при смене route. Сам ESM-чанк
// браузер всё равно кэширует, но прежний idle-delay каждый раз ещё на 320–900ms возвращал
// статичный fallback — это читалось как «капсула заново подгрузилась и изменила размер».
// Держим один promise на приложение и запоминаем, что WebGL уже был успешно прогрет:
// первый вход остаётся бережным к загрузке, последующие экраны получают canvas сразу.
let mascotModulePromise: Promise<MascotModule> | null = null;
let headerMascotWarm = false;

function loadMascotModule(): Promise<MascotModule> {
  mascotModulePromise ??= import("./mascot3d.ts");
  return mascotModulePromise;
}

function canRunLiveMascot(): boolean {
  if (typeof window === "undefined") return false;
  if (!window.matchMedia?.("(pointer: fine)").matches) return false;
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return false;
  const navigatorHints = navigator as NavigatorWithHints;
  if (navigatorHints.connection?.saveData) return false;
  if (navigatorHints.deviceMemory !== undefined && navigatorHints.deviceMemory < 4) return false;
  return window.innerWidth >= 760 && !document.hidden;
}

export function LiveHeaderMascot({
  config,
  snapshots,
  active,
  notificationCount,
  suspended,
  typing,
}: {
  config: AvatarConfig;
  snapshots: AvatarSnapshots | null;
  active: boolean;
  notificationCount: number;
  suspended: boolean;
  typing?: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<HeaderMascotSceneHandle | null>(null);
  const configRef = useRef(config);
  const previousNotifications = useRef(notificationCount);
  const [enabled, setEnabled] = useState(() => headerMascotWarm && canRunLiveMascot());
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [editorActive, setEditorActive] = useState(false);
  const [noticePulse, setNoticePulse] = useState(false);

  useEffect(() => {
    const onEditor = (event: Event) => {
      setEditorActive(Boolean((event as CustomEvent<{ open?: boolean }>).detail?.open));
    };
    window.addEventListener("portal:avatar-editor", onEditor);
    return () => window.removeEventListener("portal:avatar-editor", onEditor);
  }, []);

  useEffect(() => {
    if (suspended || editorActive || !canRunLiveMascot()) {
      setEnabled(false);
      return;
    }
    if (headerMascotWarm) {
      setEnabled(true);
      return;
    }
    let cancelled = false;
    const idleApi = window as unknown as {
      requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
      cancelIdleCallback?: (id: number) => void;
    };
    let cancelSchedule: () => void;
    if (idleApi.requestIdleCallback) {
      const idleId = idleApi.requestIdleCallback(() => !cancelled && setEnabled(true), { timeout: 900 });
      cancelSchedule = () => idleApi.cancelIdleCallback?.(idleId);
    } else {
      const timer = setTimeout(() => !cancelled && setEnabled(true), 320);
      cancelSchedule = () => clearTimeout(timer);
    }
    return () => {
      cancelled = true;
      cancelSchedule();
    };
  }, [suspended, editorActive]);

  useEffect(() => {
    if (!enabled || failed || suspended || !canvasRef.current) return;
    let cancelled = false;
    void loadMascotModule()
      .then((module) => {
        if (cancelled || !canvasRef.current) return;
        sceneRef.current = module.createHeaderMascotScene(canvasRef.current, configRef.current, () => {
          setFailed(true);
          setReady(false);
        });
        headerMascotWarm = true;
        setReady(true);
      })
      .catch(() => setFailed(true));
    return () => {
      cancelled = true;
      sceneRef.current?.dispose();
      sceneRef.current = null;
      setReady(false);
    };
  }, [enabled, failed, suspended]);

  useEffect(() => {
    configRef.current = config;
    sceneRef.current?.setConfig(config);
  }, [config]);

  useEffect(() => {
    sceneRef.current?.setReaction(noticePulse ? "notice" : active ? "engaged" : typing ? "typing" : "idle");
  }, [active, typing, noticePulse]);

  useEffect(() => {
    let timer = 0;
    if (notificationCount > previousNotifications.current) {
      setNoticePulse(true);
      timer = window.setTimeout(() => setNoticePulse(false), 800);
    }
    previousNotifications.current = notificationCount;
    return () => window.clearTimeout(timer);
  }, [notificationCount]);

  useEffect(() => {
    if (!enabled || suspended) return;
    let pointerRaf = 0;
    let pointerX: number = HEADER_MASCOT_REST_POINTER.x;
    let pointerY: number = HEADER_MASCOT_REST_POINTER.y;
    const onPointerMove = (event: PointerEvent) => {
      // Персонаж стоит в правом верхнем углу и композиционно смотрит внутрь страницы —
      // влево-вниз. Курсор остаётся живым входом, но лишь слегка смещает этот базовый взгляд,
      // поэтому наведение на сам аватар больше не разворачивает его наружу вправо.
      const nextPointer = headerMascotPointerForCursor(
        event.clientX,
        event.clientY,
        window.innerWidth,
        window.innerHeight,
      );
      pointerX = nextPointer.x;
      pointerY = nextPointer.y;
      if (pointerRaf) return;
      pointerRaf = requestAnimationFrame(() => {
        sceneRef.current?.setPointer(pointerX, pointerY);
        pointerRaf = 0;
      });
    };
    const onVisibility = () => sceneRef.current?.setVisible(!document.hidden);
    window.addEventListener("pointermove", onPointerMove, { passive: true });
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      document.removeEventListener("visibilitychange", onVisibility);
      if (pointerRaf) cancelAnimationFrame(pointerRaf);
    };
  }, [enabled, suspended]);

  return (
    <span className="liveHeaderMascot" data-ready={ready || undefined} data-reaction={typing ? "typing" : undefined} aria-hidden="true">
      <span className="liveHeaderMascotFallback">
        <AvatarBubble config={config} snapshots={snapshots} size={44} facing="left" />
      </span>
      {enabled && !failed && !suspended ? (
        <canvas ref={canvasRef} className="liveHeaderMascotCanvas" width={72} height={72} />
      ) : null}
    </span>
  );
}
