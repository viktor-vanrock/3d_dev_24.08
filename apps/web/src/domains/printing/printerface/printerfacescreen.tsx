import { useEffect, useRef, useState } from "react";
import { useOverlay, severityFromPrinter, severityConfig, playSound, type PrinterProblem } from "@platform/overlay";
import { useInteractionSound } from "@platform/sound";
import { FaceCapsule } from "./facecapsule.tsx";
import { mockPrinterFaceSource, type FaceState } from "./facesource.ts";
import { AlertScene } from "./scenes/alertscene.tsx";
import { EnrollScene } from "./scenes/enrollscene.tsx";
import { FilePickerScene } from "./scenes/filepickerscene.tsx";
import { IdleScene } from "./scenes/idlescene.tsx";
import { PrintingScene } from "./scenes/printingscene.tsx";
import { SettingsScene } from "./scenes/settingsscene.tsx";
import "./printerface.css";

type FaceNav = "process" | "files" | "enroll" | "settings";

const DEV_PROBLEMS: PrinterProblem[] = ["filament_runout", "jam", "thermal_runaway", "adhesion_fail", "offline"];

// Морда принтера (MF-926, printer.face.md §2) — 7 сцен на моках (§2.3 a–g), закреплённая шапка
// (§2.4), офлайн-честность (§2.5). Один responsive слой для обоих вьюпортов (§2.1/2.2) — верстка
// не ветвится по kiosk/browser в JS, только текучими CSS-размерами (printerface.css).
export function PrinterFaceScreen() {
  const [source] = useState(() => mockPrinterFaceSource());
  const [state, setState] = useState<FaceState | null>(null);
  const [nav, setNav] = useState<FaceNav>("process");
  const overlay = useOverlay();
  const sound = useInteractionSound();
  const devTools = new URLSearchParams(window.location.search).get("dev") === "1";

  useEffect(() => source.subscribe(setState), [source]);

  // Появление алерта (§2.6) — звук по severity через overlay/sound.ts, 1:1 с порталом. Не через
  // overlay.alert()/usePrinterAlerts: тот путь рисует ЕЩЁ и мелкую угловую карточку (AlertHost,
  // всегда смонтирован внутри OverlayProvider) — здесь свой полноэкранный баннер (сцена d ниже),
  // второй карточки быть не должно, поэтому дёргаем звук напрямую по тому же словарю severity.
  const lastProblemRef = useRef<PrinterProblem | null>(null);
  useEffect(() => {
    if (!state) return;
    if (state.problem && state.problem !== lastProblemRef.current) {
      const severity = severityFromPrinter(state.problem, Date.now() - state.problemSince);
      const kind = severityConfig(severity).sound;
      if (kind) playSound(kind, overlay.notifications.muted);
    }
    lastProblemRef.current = state.problem;
  }, [state, overlay.notifications.muted]);

  if (!state) return null;

  async function confirmStop() {
    const confirmed = await overlay.confirm({
      title: "Остановить печать?",
      message: "Текущий прогресс будет потерян — начать заново придётся с начала файла.",
      confirmLabel: "Остановить",
      cancelLabel: "Отмена",
      destructive: true,
    });
    if (!confirmed) return;
    sound.cta();
    source.setPhase("idle");
  }

  async function confirmUnlink() {
    const confirmed = await overlay.confirm({
      title: "Отвязать аккаунт?",
      message: "Локальное управление продолжит работать — печать из портала и удалённый доступ отключатся.",
      confirmLabel: "Отвязать",
      cancelLabel: "Отмена",
      destructive: true,
    });
    if (!confirmed) return;
    sound.cta();
    source.unlinkAccount();
  }

  function renderProcess() {
    if (state!.job && state!.phase !== "idle") {
      return (
        <PrintingScene
          job={state!.job}
          paused={state!.phase === "paused"}
          hasCamera={state!.hasCamera}
          onPause={() => {
            sound.tick();
            source.setPhase("paused");
          }}
          onResume={() => {
            sound.tick();
            source.setPhase("printing");
          }}
          onStop={() => void confirmStop()}
        />
      );
    }
    return (
      <IdleScene
        state={state!}
        onPrint={() => {
          sound.tick();
          setNav("files");
        }}
        onSettings={() => {
          sound.tick();
          setNav("settings");
        }}
      />
    );
  }

  function renderScene() {
    if (state!.problem) {
      return (
        <AlertScene
          problem={state!.problem}
          since={state!.problemSince}
          onPause={() => {
            source.setPhase("paused");
            source.setProblem(null);
          }}
          onStop={() => {
            source.setPhase("idle");
            source.setProblem(null);
          }}
          onDetails={() => {
            overlay.toast({ severity: "info", title: "Откройте портал", message: "Подробности — во вкладке принтера на 3mf.tech" });
            source.setProblem(null);
          }}
        />
      );
    }
    if (nav === "files") {
      return (
        <FilePickerScene
          files={state!.files}
          onPickLocal={(name) => {
            sound.cta();
            source.startJob(name);
            setNav("process");
          }}
          onPickPortal={(_id, name) => {
            sound.cta();
            source.startJob(name);
            setNav("process");
          }}
          onOpenPortalOnPhone={() => overlay.toast({ severity: "info", title: "Откройте 3mf.tech", message: "С телефона в той же сети" })}
        />
      );
    }
    if (nav === "enroll") {
      return (
        <EnrollScene
          onLinked={(name) => {
            sound.cta();
            source.linkAccount(name);
            setNav("process");
          }}
        />
      );
    }
    if (nav === "settings") {
      return <SettingsScene state={state!} onUnlinkAccount={() => void confirmUnlink()} />;
    }
    return renderProcess();
  }

  return (
    // Морда принтера несёт собственную фикс-строку (FaceCapsule, printer.face.md §2) и
    // помечается как device-shell, не как один из режимов общей web-шапки.
    <div className="printerFace" data-device-shell="ultra">
      <FaceCapsule
        state={state}
        onHome={() => {
          sound.tick();
          setNav("process");
        }}
        onAccountPress={() => {
          sound.tick();
          setNav("enroll");
        }}
      />
      <div className="faceStage">{renderScene()}</div>
      {devTools ? <DevSceneTools source={source} nav={nav} onNav={setNav} /> : null}
    </div>
  );
}

// Панель прямых переходов между сценами для QA-скриншотов (`?dev=1`, не часть продукта —
// приём аналогичен pages/kitchensink.tsx: инструмент стенда, не пользовательский экран).
function DevSceneTools({
  source: mock,
  nav,
  onNav,
}: {
  source: ReturnType<typeof mockPrinterFaceSource>;
  nav: FaceNav;
  onNav: (nav: FaceNav) => void;
}) {
  return (
    <div className="faceDevTools">
      <button type="button" onClick={() => { mock.setProblem(null); mock.setPhase("idle"); onNav("process"); }}>
        a
      </button>
      <button
        type="button"
        onClick={() => {
          mock.setProblem(null);
          mock.startJob("benchy.gcode");
          onNav("process");
        }}
      >
        b
      </button>
      <button
        type="button"
        onClick={() => {
          mock.setProblem(null);
          mock.startJob("benchy.gcode");
          mock.setPhase("paused");
          onNav("process");
        }}
      >
        c
      </button>
      <button
        type="button"
        onClick={() => {
          mock.startJob("benchy.gcode");
          mock.setProblem(DEV_PROBLEMS[Math.floor(Math.random() * DEV_PROBLEMS.length)] ?? "jam");
        }}
      >
        d
      </button>
      <button type="button" onClick={() => { mock.setProblem(null); onNav("files"); }}>
        e
      </button>
      <button type="button" onClick={() => { mock.setProblem(null); onNav("enroll"); }}>
        f
      </button>
      <button type="button" onClick={() => { mock.setProblem(null); onNav("settings"); }}>
        g
      </button>
      <span className="faceDevToolsNav">nav: {nav}</span>
    </div>
  );
}
