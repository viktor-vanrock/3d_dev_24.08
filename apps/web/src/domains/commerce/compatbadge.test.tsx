import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { UserPrinter } from "@shared/lib";
import { ModelCompatBadges } from "./compatbadge.tsx";

// Бейдж совместимости карточки модели (MF-410, Фаза 3 эпика MF-33): по вердикту
// compat.check(принтер, модель) на каждый принтер парка ЛК зрителя. Готово когда (карточка
// MF-410): корректный вердикт для каждого принтера с причиной; пустой парк → нейтральная
// деградация без ошибки.

function printer(overrides: Partial<UserPrinter> = {}): UserPrinter {
  return { id: "p1", brand: "Bambu Lab", model: "A1 mini", is_primary: true, verified: true, ...overrides };
}

function mockCompat(byPrinterId: Record<string, { verdict: string; reasons: Array<{ code: string; severity: string; message: string }> }>) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const match = url.match(/\/me\/printers\/([^/]+)\/compat/);
      if (match) {
        const printerId = match[1]!;
        const result = byPrinterId[printerId];
        if (!result) return new Response(null, { status: 404 });
        return new Response(JSON.stringify({ printer_id: printerId, material_id: null, model_id: "m1", ...result }), { status: 200 });
      }
      return new Response(null, { status: 404 });
    }),
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("ModelCompatBadges", () => {
  it("пустой парк — нейтральная деградация без ошибки, CTA в парк", () => {
    render(<ModelCompatBadges modelId="m1" printers={[]} />);

    expect(screen.getByText("Привяжите принтер — покажем, влезет ли модель")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Открыть парк →" })).toBeTruthy();
  });

  it("verdict ok — показывает «печатается на» без причины блокировки", async () => {
    mockCompat({ p1: { verdict: "ok", reasons: [] } });
    render(<ModelCompatBadges modelId="m1" printers={[printer()]} />);

    expect(await screen.findByText('Печатается на «Bambu Lab A1 mini»')).toBeTruthy();
  });

  it("verdict blocked (геометрия) — короткая причина «не влезет»", async () => {
    mockCompat({
      p1: {
        verdict: "blocked",
        reasons: [{ code: "geometry_exceeds_build_volume", severity: "blocked", message: "Модель 300×300×300 мм не влезает…" }],
      },
    });
    render(<ModelCompatBadges modelId="m1" printers={[printer({ brand: "Creality", model: "Ender 3" })]} />);

    expect(await screen.findByText("Creality Ender 3: не влезет")).toBeTruthy();
  });

  it("verdict warn (камера) — короткая причина «нужна камера», полный текст в title", async () => {
    mockCompat({
      p1: {
        verdict: "warn",
        reasons: [{ code: "chamber_recommended", severity: "warn", message: "Материал склонен к варпингу без камеры." }],
      },
    });
    render(<ModelCompatBadges modelId="m1" printers={[printer({ brand: "Creality", model: "Ender 3" })]} />);

    const badge = await screen.findByText("Creality Ender 3: нужна камера");
    expect(badge.closest("[title]")?.getAttribute("title")).toBe("Материал склонен к варпингу без камеры.");
  });

  it("несколько принтеров парка — по бейджу на каждый", async () => {
    mockCompat({
      p1: { verdict: "ok", reasons: [] },
      p2: { verdict: "blocked", reasons: [{ code: "geometry_exceeds_build_volume", severity: "blocked", message: "не влезает" }] },
    });
    render(
      <ModelCompatBadges
        modelId="m1"
        printers={[printer({ id: "p1" }), printer({ id: "p2", brand: "Creality", model: "Ender 3" })]}
      />,
    );

    expect(await screen.findByText('Печатается на «Bambu Lab A1 mini»')).toBeTruthy();
    expect(await screen.findByText("Creality Ender 3: не влезет")).toBeTruthy();
  });
});
