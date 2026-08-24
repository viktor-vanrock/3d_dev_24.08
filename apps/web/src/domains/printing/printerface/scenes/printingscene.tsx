import { useEffect, useRef, useState } from "react";
import { StatusPill } from "@shared/ui";
import { usePrefersReducedMotion } from "@platform/theme";
import type { FaceJob } from "../facesource.ts";

function StopIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M6 6l12 12M18 6 6 18" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  );
}

function CameraIcon() {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="3" y="7" width="14" height="11" rx="2" stroke="currentColor" strokeWidth="1.6" />
      <path d="M17 10.5 21 8v8l-4-2.5" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  );
}

// Count-up (motion.md, printer.face.md §2.6) — процент подкручивается к новому значению, не
// скачет мгновенно; выключено при prefers-reduced-motion (reducedmotion.ts — общий источник).
function useCountUp(target: number, reduced: boolean): number {
  const [display, setDisplay] = useState(target);
  const fromRef = useRef(target);
  useEffect(() => {
    if (reduced) {
      setDisplay(target);
      fromRef.current = target;
      return;
    }
    const from = fromRef.current;
    if (from === target) return;
    const start = performance.now();
    const duration = 500;
    let frame: number;
    function tick(now: number) {
      const t = Math.min(1, (now - start) / duration);
      setDisplay(Math.round(from + (target - from) * t));
      if (t < 1) frame = requestAnimationFrame(tick);
      else fromRef.current = target;
    }
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target, reduced]);
  return display;
}

// Сцены (b)/(c) — печать идёт / пауза (printer.face.md §2.3.b/c). Разворот контраста в hero —
// ЕДИНСТВЕННОЕ применение приёма на морде, только для активного прогресса; на паузе hero гаснет
// до обычной тёмной карточки (§2.3.c).
export function PrintingScene({
  job,
  paused,
  hasCamera,
  onPause,
  onResume,
  onStop,
}: {
  job: FaceJob;
  paused: boolean;
  hasCamera: boolean;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
}) {
  const reduced = usePrefersReducedMotion();
  const displayProgress = useCountUp(job.progress, reduced);

  return (
    <div className="faceScene faceScene--printing reveal">
      <div className="faceSceneBody">
        <div className="faceProcessRow">
          <div className="faceHeroPanel" data-active={!paused || undefined}>
            {paused ? (
              <div className="faceHeroPanelPaused">На паузе</div>
            ) : (
              <div className="faceHeroPanelValue">{displayProgress}%</div>
            )}
            <div className="faceHeroPanelFile">{job.fileName}</div>
          </div>
          {hasCamera ? (
            <button type="button" className="faceCameraTile pressable" aria-label="Развернуть камеру">
              <CameraIcon />
            </button>
          ) : null}
        </div>

        <div className="faceTempRow">
          <StatusPill tone={job.nozzle.tone}>Сопло {job.nozzle.value}°</StatusPill>
          <StatusPill tone={job.bed.tone}>Стол {job.bed.value}°</StatusPill>
        </div>
      </div>

      <div className="faceActionRow">
        {paused ? (
          <button type="button" className="faceActionCard pressable" data-variant="primary" onClick={onResume}>
            <span className="faceActionCardTitle">Продолжить</span>
          </button>
        ) : (
          <button type="button" className="faceActionCard pressable" data-variant="ghost" onClick={onPause}>
            <span className="faceActionCardTitle">Пауза</span>
          </button>
        )}
        <button type="button" className="faceStopButton pressable" aria-label="Стоп" onClick={onStop}>
          <StopIcon />
        </button>
      </div>
    </div>
  );
}
