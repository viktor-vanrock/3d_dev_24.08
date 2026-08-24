import type { PrinterProblem } from "@platform/overlay";

/*
  Морда принтера (MF-926, docs/design/printer.face.md §2). MVP на моках — Back-туннель
  телеметрии (MF-886) ещё спайк (issue-описание MF-926). Тот же приём, что мок алертов
  (overlay/alert/severity-from-printer.ts, mockPrinterStatusSource): экран зависит только от
  интерфейса `PrinterFaceSource`, реализация подменяется на реальный поток отдельной карточкой
  (Fullstack, когда MF-886/887 готовы) без правки вёрстки.

  Поля — ровно контракт `PrinterDriver` (printer.server.md §2.2/§2.7): getState()
  (phase/job/problem), subscribeTelemetry() (temps/progress), camera() (hasCamera), очередь/файлы
  (files, из портал-аккаунта) — пятое поле сверх контракта не выдумываем.
*/

export type FacePhase = "idle" | "printing" | "paused";

export type TempTone = "ok" | "warn";

export interface FaceTemp {
  value: number;
  tone: TempTone;
}

export interface FaceJob {
  fileName: string;
  progress: number; // 0..100
  nozzle: FaceTemp;
  bed: FaceTemp;
}

export interface PortalProject {
  id: string;
  name: string;
}

// Файлы сцены (e): локальные — всегда доступны (Klipper/Moonraker не зависят от облака,
// §2.5); портальные — только когда relayOnline (честный оффлайн-деградация, §2.5).
export interface FaceFiles {
  local: string[];
  portal: PortalProject[] | null;
}

export interface FaceState {
  printerName: string;
  model: string;
  phase: FacePhase;
  job: FaceJob | null;
  problem: PrinterProblem | null;
  problemSince: number;
  hasCamera: boolean;
  accountLinked: boolean;
  accountName: string | null;
  relayOnline: boolean;
  files: FaceFiles;
}

export interface PrinterFaceSource {
  subscribe(onUpdate: (state: FaceState) => void): () => void;
}

export interface MockPrinterFaceSource extends PrinterFaceSource {
  setPhase(phase: FacePhase): void;
  startJob(fileName: string): void;
  setProgress(progress: number): void;
  setProblem(problem: PrinterProblem | null): void;
  setRelayOnline(online: boolean): void;
  linkAccount(name: string): void;
  unlinkAccount(): void;
}

const DEFAULT_LOCAL_FILES = ["benchy.gcode", "калибровка_стола.gcode", "кронштейн_v3.gcode"];
const DEFAULT_PORTAL_PROJECTS: PortalProject[] = [
  { id: "p1", name: "Держатель катушки" },
  { id: "p2", name: "Корпус вентилятора 40мм" },
];

export function mockPrinterFaceSource(initial?: Partial<FaceState>): MockPrinterFaceSource {
  let state: FaceState = {
    printerName: "Мой принтер",
    model: "Voron 2.4",
    phase: "idle",
    job: null,
    problem: null,
    problemSince: 0,
    hasCamera: true,
    accountLinked: false,
    accountName: null,
    relayOnline: true,
    files: { local: DEFAULT_LOCAL_FILES, portal: DEFAULT_PORTAL_PROJECTS },
    ...initial,
  };

  const listeners = new Set<(state: FaceState) => void>();

  function notify() {
    listeners.forEach((listener) => listener(state));
  }

  function patch(next: Partial<FaceState>) {
    state = { ...state, ...next };
    notify();
  }

  return {
    subscribe(onUpdate) {
      listeners.add(onUpdate);
      onUpdate(state);
      return () => listeners.delete(onUpdate);
    },
    setPhase(phase) {
      if (phase === "idle") {
        patch({ phase, job: null, problem: null });
        return;
      }
      patch({ phase });
    },
    startJob(fileName) {
      patch({
        phase: "printing",
        job: { fileName, progress: 3, nozzle: { value: 215, tone: "ok" }, bed: { value: 60, tone: "ok" } },
        problem: null,
      });
    },
    setProgress(progress) {
      if (!state.job) return;
      patch({ job: { ...state.job, progress: Math.min(100, Math.max(0, progress)) } });
    },
    setProblem(problem) {
      patch({ problem, problemSince: problem ? Date.now() : 0 });
    },
    setRelayOnline(online) {
      patch({ relayOnline: online, files: { ...state.files, portal: online ? DEFAULT_PORTAL_PROJECTS : null } });
    },
    linkAccount(name) {
      patch({ accountLinked: true, accountName: name });
    },
    unlinkAccount() {
      patch({ accountLinked: false, accountName: null });
    },
  };
}
