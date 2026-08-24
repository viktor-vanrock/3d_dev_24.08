import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { OverlayProvider } from "@platform/overlay";
import { ThemeProvider } from "@platform/theme";
import { PrinterFaceScreen } from "./printerfacescreen.tsx";

// Морда принтера (MF-926, docs/design/printer.face.md §2) — MVP на моках. Проверяем навигацию
// между сценами и честную деградацию, не пиксели (визуал сверяется webcheck-скринами, см.
// комментарий к карточке).

function renderFace() {
  return render(
    <ThemeProvider>
      <OverlayProvider>
        <PrinterFaceScreen />
      </OverlayProvider>
    </ThemeProvider>,
  );
}

afterEach(() => {
  cleanup();
  window.history.pushState(null, "", "/");
});

describe("PrinterFaceScreen", () => {
  it("по умолчанию — сцена (a): готов к печати, аккаунт не привязан в шапке", async () => {
    renderFace();
    expect(await screen.findByText(/Готов к/)).toBeTruthy();
    expect(screen.getByText("Аккаунт не привязан")).toBeTruthy();
  });

  it("(a) «Напечатать» → сцена (e), выбор локального файла запускает печать → сцена (b)", async () => {
    renderFace();
    fireEvent.click(await screen.findByText("Напечатать"));
    expect(await screen.findByText("Файл для печати")).toBeTruthy();
    expect(screen.getByText("benchy.gcode")).toBeTruthy();
    expect(screen.getByText("Из портала")).toBeTruthy();

    fireEvent.click(screen.getByText("benchy.gcode"));
    expect(await screen.findByText("3%")).toBeTruthy();
    expect(screen.getByText("benchy.gcode")).toBeTruthy();
  });

  it("(a) «Настройки» → сцена (g), список статуса агента без привязанного аккаунта", async () => {
    renderFace();
    fireEvent.click(await screen.findByText("Настройки"));
    expect(await screen.findByText("Wi-Fi")).toBeTruthy();
    // Аккаунт не привязан — кнопки «Отвязать аккаунт» нет (нечего отвязывать).
    expect(screen.queryByText("Отвязать аккаунт")).toBeNull();
  });

  it("непривязанная аккаунт-пилюля в шапке ведёт на сцену (f) — enroll-код", async () => {
    renderFace();
    fireEvent.click(await screen.findByText("Аккаунт не привязан"));
    expect(await screen.findByText("Вход в портал-аккаунт")).toBeTruthy();
    fireEvent.click(screen.getByText("Получить код"));
    expect(await screen.findByText("7F3K-9QRT")).toBeTruthy();
  });

  it("?dev=1 — dev-панель прыгает по сценам b/c/e/f/g напрямую", async () => {
    window.history.pushState(null, "", "/face?dev=1");
    renderFace();
    fireEvent.click(await screen.findByText("c"));
    expect(await screen.findByText("На паузе")).toBeTruthy();
    expect(screen.getByText("Продолжить")).toBeTruthy();
  });

  it("сцена (d) — алерт использует ровно словарь причин портала (reasons.ts)", async () => {
    window.history.pushState(null, "", "/face?dev=1");
    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0);
    renderFace();
    fireEvent.click(await screen.findByText("d"));
    // DEV_PROBLEMS[0] с Math.random()=0 — "filament_runout" (reasons.ts PROBLEM_CATALOG).
    expect(await screen.findByText("Обрыв филамента")).toBeTruthy();
    expect(screen.getByText("Катушка закончилась или нить порвалась перед экструдером")).toBeTruthy();
    expect(screen.getByText("Пауза")).toBeTruthy();
    expect(screen.getByText("Стоп")).toBeTruthy();
    expect(screen.getByText("Разобраться")).toBeTruthy();
    randomSpy.mockRestore();
  });

  it("«Разобраться» снимает алерт и возвращает текущую сцену процесса", async () => {
    window.history.pushState(null, "", "/face?dev=1");
    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0);
    renderFace();
    fireEvent.click(await screen.findByText("d"));
    expect(await screen.findByText("Обрыв филамента")).toBeTruthy();
    fireEvent.click(screen.getByText("Разобраться"));
    expect(await screen.findByText("3%")).toBeTruthy();
    randomSpy.mockRestore();
  });
});
