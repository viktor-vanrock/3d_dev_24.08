import { describe, expect, it } from "vitest";
import { mockPrinterFaceSource, type FaceState } from "./facesource.ts";

// Мок-источник морды принтера (MF-926, printer.face.md §2.3/§2.5) — тот же приём, что
// overlay/alert/severity-from-printer.ts mockPrinterStatusSource: экран не знает, что это мок,
// поэтому логика источника проверяется отдельно от рендера сцен.
function subscribeSnapshot(source: ReturnType<typeof mockPrinterFaceSource>): FaceState {
  let last!: FaceState;
  source.subscribe((state) => {
    last = state;
  });
  return last;
}

describe("mockPrinterFaceSource", () => {
  it("стартует в idle, без job/problem, аккаунт не привязан", () => {
    const source = mockPrinterFaceSource();
    const snapshot = subscribeSnapshot(source);
    expect(snapshot.phase).toBe("idle");
    expect(snapshot.job).toBeNull();
    expect(snapshot.problem).toBeNull();
    expect(snapshot.accountLinked).toBe(false);
  });

  it("startJob переводит в printing и заводит job с прогрессом 3%", () => {
    const source = mockPrinterFaceSource();
    source.subscribe(() => {});
    source.startJob("benchy.gcode");
    const snapshot = subscribeSnapshot(source);
    expect(snapshot.phase).toBe("printing");
    expect(snapshot.job).toEqual({ fileName: "benchy.gcode", progress: 3, nozzle: { value: 215, tone: "ok" }, bed: { value: 60, tone: "ok" } });
  });

  it("setPhase('idle') сбрасывает job и problem (§2.3.a — простой чист от предыдущего состояния)", () => {
    const source = mockPrinterFaceSource();
    source.startJob("benchy.gcode");
    source.setProblem("jam");
    source.setPhase("idle");
    const snapshot = subscribeSnapshot(source);
    expect(snapshot.phase).toBe("idle");
    expect(snapshot.job).toBeNull();
    expect(snapshot.problem).toBeNull();
  });

  it("setRelayOnline(false) прячет files.portal целиком, не пустым списком (§2.5 честность оффлайна)", () => {
    const source = mockPrinterFaceSource();
    expect(subscribeSnapshot(source).files.portal).not.toBeNull();
    source.setRelayOnline(false);
    const snapshot = subscribeSnapshot(source);
    expect(snapshot.relayOnline).toBe(false);
    expect(snapshot.files.portal).toBeNull();
    // Локальные файлы не зависят от relay — Klipper/Moonraker управляются локально (§2.5).
    expect(snapshot.files.local.length).toBeGreaterThan(0);
  });

  it("linkAccount/unlinkAccount переключают accountLinked+accountName", () => {
    const source = mockPrinterFaceSource();
    source.linkAccount("Иван П.");
    expect(subscribeSnapshot(source).accountLinked).toBe(true);
    expect(subscribeSnapshot(source).accountName).toBe("Иван П.");
    source.unlinkAccount();
    expect(subscribeSnapshot(source).accountLinked).toBe(false);
    expect(subscribeSnapshot(source).accountName).toBeNull();
  });
});
