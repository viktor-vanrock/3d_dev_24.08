import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { OverlayProvider } from "@platform/overlay";
import { ThemeProvider } from "@platform/theme";
// eslint-disable-next-line boundaries/element-types -- легатное междоменное ребро (Этап 8): printing-тест→social ThreadScreen (интеграционный рендер треда принтера), развязка отложена до pages/DI. См. MIGRATION.md.
import { ThreadScreen } from "@domains/social";
import { PrinterDetailScreen } from "./printerdetailscreen.tsx";
import { listPrintersFixture } from "./fixtures.ts";
// eslint-disable-next-line boundaries/element-types -- легатное междоменное ребро (Этап 9): printing-тест→ai PrinterRecord, развязка отложена до pages/DI. См. MIGRATION.md.
import type { PrinterRecord } from "@domains/ai";
import firmwarePilotContract from "../../../../../../packages/contracts/http/fixtures/firmware-pilot.v1.json";

const kePilotStatus = firmwarePilotContract.examples.find((example) => example.model.slug === "creality.ender-3-v3-ke")?.pilot_status;

// 2026-07-21: экран теперь читает GET /printers (research/api.ts#listPrinters), не
// fixtures.ts#listPrintersFixture напрямую (та осталась только как источник тестовых данных
// здесь) — beforeEach ниже отвечает на /printers?... тем же расширенным набором, которым раньше
// подменялся сам модуль fixtures.ts.
let extendedPrinters: Awaited<ReturnType<typeof listPrintersFixture>> = [];
beforeEach(async () => {
  const rows = await listPrintersFixture();
  const base = rows[0];
  extendedPrinters = base
    ? [
        ...rows,
        {
          ...base,
          id: "creality.ender3-v3-ke",
          slug: "creality.ender3-v3-ke",
          brand: "Creality",
          model: "Ender-3 V3 KE",
          pilot_status: kePilotStatus as PrinterRecord["pilot_status"],
        },
      ]
    : rows;
});

// `/printers/<slug>` (MF-927, docs/design/printers.catalog.md §4) — секции спек только по
// заполненным полям (§4.3), анонсированная карточка — полноценное состояние, не 404 (§4.2).

const user = { id: "u1", username: "tester", display_name: null, avatar_url: null, handle_confirmed: true, role: "user" as const };

function renderDetail(slug: string) {
  return render(
    <ThemeProvider>
      <OverlayProvider>
        <PrinterDetailScreen user={user} section="printers" onSectionChange={() => {}} slug={slug} />
      </OverlayProvider>
    </ThemeProvider>,
  );
}

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).startsWith("/printers?")) {
        return new Response(JSON.stringify({ printers: extendedPrinters, has_more: false, next_cursor: null }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(null, { status: 404 });
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  sessionStorage.clear();
  window.history.replaceState(null, "", "/printers/creality.k1-max");
});

function printerEvents(fetchSpy: ReturnType<typeof vi.fn>) {
  return fetchSpy.mock.calls
    .filter(([input]) => String(input).endsWith("/feed/events"))
    .map(([, init]) => JSON.parse(String((init as RequestInit).body)) as { event_name: string; props: Record<string, unknown> });
}

describe("PrinterDetailScreen (MF-927)", () => {
  it("рендерит только заполненные секции, без сетки прочерков «—»", async () => {
    renderDetail("creality.k1-max");
    await waitFor(() => expect(screen.getByText(/K1 Max/)).toBeTruthy());
    expect(screen.getByText("Хотэнд")).toBeTruthy();
    expect(screen.getByText(/24/)).toBeTruthy(); // hotend.max_flow_mm3s (без сноски-провенанса)
    expect(screen.queryByText("—")).toBeNull();
    // dimensions_mm у k1-max — null, но явно в _meta.gaps («искали, не нашли», §0 п.2): секция
    // рендерится с одной честной строкой пробела, а не сеткой прочерков.
    expect(screen.getByText("Габариты")).toBeTruthy();
    expect(screen.getByText(/Не заполнено:.*Ширина/)).toBeTruthy();
    // toolhead_extras — пустой массив, НЕ в gaps («не трогали», §0 п.2) — секции нет вообще.
    expect(screen.queryByText("Уникальные головы (лазер/ЧПУ)")).toBeNull();
  });

  it("анонсированная карточка (§4.2) — «Уведомить о выходе» вместо обычных действий, не 404", async () => {
    renderDetail("vulcan.one");
    await waitFor(() => expect(screen.getByText(/Vulcan One/)).toBeTruthy());
    expect(screen.getByText("Уведомить о выходе")).toBeTruthy();
    expect(screen.queryByText("Это мой принтер")).toBeNull();
    expect(screen.queryByText("Такого принтера у нас пока нет")).toBeNull();
  });

  it("неизвестный slug → честный «не найдено», не пустой экран", async () => {
    renderDetail("does-not-exist");
    await waitFor(() => expect(screen.getByText("Такого принтера у нас пока нет")).toBeTruthy());
  });

  it("устаревшая РУ-цена помечается датой (§2.11)", async () => {
    renderDetail("bambulab.x1-carbon");
    await waitFor(() => expect(screen.getByText(/X1 Carbon/)).toBeTruthy());
    expect(screen.getByText(/февраль 2026/)).toBeTruthy();
  });

  it("дверь «Сообщить о проблеме» сохраняет ссылку на карточку принтера", async () => {
    const interaction = userEvent.setup();
    renderDetail("creality.k1-max");
    await waitFor(() => expect(screen.getByText(/K1 Max/)).toBeTruthy());

    await interaction.click(screen.getByRole("button", { name: "Сообщить о проблеме" }));

    expect(window.location.pathname).toBe("/issue/new");
    const params = new URLSearchParams(window.location.search);
    expect(params.get("ref_type")).toBe("printer");
    expect(params.get("ref_id")).toBe("creality.k1-max");
  });

  it("support_level=list (MF-892) — бейдж «В каталоге» + выходы «Сделать самому»/«Прошивки сообщества»", async () => {
    renderDetail("creality.k1-max");
    await waitFor(() => expect(screen.getByText(/K1 Max/)).toBeTruthy());
    expect(screen.getByText("В каталоге")).toBeTruthy();
    expect(screen.getByText("Сделать самому")).toBeTruthy();
    expect(screen.getByText("Прошивки сообщества")).toBeTruthy();
    expect(screen.queryByText("Управлять")).toBeNull();
    expect(screen.queryByText("Поставить прошивку")).toBeNull();
  });

  it("support_level=managed (MF-1247) — бейдж «Управляется» и безопасный переход в парк вместо обещания управления", async () => {
    renderDetail("voron.trident");
    await waitFor(() => expect(screen.getByText(/Trident/)).toBeTruthy());
    expect(screen.getByText("Управляется")).toBeTruthy();
    expect(screen.getByText("Локально, в вашей сети")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Добавить в парк" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Управлять" })).toBeNull();
    expect(screen.queryByText("Сделать самому")).toBeNull();
  });

  it("support_level=custom + firmware_ready (MF-892) — FlagshipBadge, «доступ по запросу», кнопка «Поставить прошивку»", async () => {
    renderDetail("creality.k2-plus");
    await waitFor(() => expect(screen.getByText(/K2 Plus/)).toBeTruthy());
    expect(screen.getByText("Полный портал")).toBeTruthy();
    expect(screen.getByText("доступ по запросу")).toBeTruthy();
    expect(screen.getByText("Поставить прошивку")).toBeTruthy();
  });

  it("показывает устаревший статус из consumer fixture на карточке Ender-3 V3 KE", async () => {
    renderDetail("creality.ender3-v3-ke");

    // Доступное имя включает модель и точный текст §3.3 (не общий текст без модели, MF-1868/MF-1869).
    const date = new Date(kePilotStatus!.updated_at as string).toLocaleString("ru-RU");
    expect(
      await screen.findByRole("button", {
        name: `Пилот прошивки Creality Ender-3 V3 KE: данные устарели. Последний факт — не начат, обновлён ${date}`,
      }),
    ).toBeTruthy();
    expect(screen.queryByText("Пилот прошивки: не начат")).toBeNull();
    expect(screen.getByText(`Последний факт: не начат, обновлено ${date}`)).toBeTruthy();
  });

  it("не показывает пустой статус пилота как интерактивный тег", async () => {
    renderDetail("creality.k1-max");

    await screen.findByRole("heading", { name: /K1 Max/ });
    expect(screen.queryByRole("button", { name: "Пилот прошивки: нет данных о пилоте" })).toBeNull();
  });

  it("показывает хвост сообщества и проекты принтера", async () => {
    renderDetail("creality.k1-max");
    expect(await screen.findByRole("heading", { name: "Обсуждение" })).toBeTruthy();
    expect(screen.getByText("Настройки профиля и первый слой")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Открыть сообщество →" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Что на нём печатают" })).toBeTruthy();
    expect(screen.getByText("Кронштейн для камеры")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Смотреть все проекты →" })).toBeTruthy();
  });

  it("справочник (MF-494): показывает wiki вендора и совместимые слайсеры по брендy", async () => {
    renderDetail("creality.k1-max");
    expect(await screen.findByRole("heading", { name: "Справочник" })).toBeTruthy();
    expect(screen.getByRole("link", { name: /^Creality Wiki/ }).getAttribute("href")).toBe("https://wiki.creality.com/en/home");
    expect(screen.getByRole("link", { name: /^Creality Print/ }).getAttribute("href")).toBe("https://wiki.creality.com/en/software/creality-print");
    expect(screen.getByRole("link", { name: /^OrcaSlicer Wiki/ }).getAttribute("href")).toBe("https://github.com/SoftFever/OrcaSlicer/wiki");
  });

  it("справочник (MF-494): бренд без записи в курируемом списке — секция не рендерится", async () => {
    renderDetail("vulcan.one");
    await waitFor(() => expect(screen.getByText(/Vulcan One/)).toBeTruthy());
    expect(screen.queryByRole("heading", { name: "Справочник" })).toBeNull();
  });

  it("открывает выбранный тред из превью обсуждения", async () => {
    const interaction = userEvent.setup();
    renderDetail("creality.k1-max");

    await interaction.click(await screen.findByRole("button", { name: /Настройки профиля и первый слой/ }));

    expect(window.location.pathname).toBe("/thread/printer-creality.k1-max-profile");
  });

  it("открывает read-only топик для треда из статического превью, а не страницу 404", async () => {
    render(
      <ThemeProvider>
        <OverlayProvider>
          <ThreadScreen user={user} section="printers" onSectionChange={() => {}} id="printer-creality.k1-max-profile" />
        </OverlayProvider>
      </ThemeProvider>,
    );

    expect(await screen.findByRole("heading", { name: "Настройки профиля и первый слой" })).toBeTruthy();
    expect(screen.queryByText("Тред не найден")).toBeNull();
  });

  it("переносит сравнение на фото и оставляет обратную связь после характеристик", async () => {
    renderDetail("creality.k1-max");

    const compare = await screen.findByRole("button", { name: "Добавить Creality K1 Max к сравнению" });
    const feedback = screen.getByRole("button", { name: "Сообщить о проблеме" });
    const volume = screen.getByText("Объём печати");

    expect(compare.getAttribute("class")).toContain("prnHeroCompare");
    expect(volume.compareDocumentPosition(feedback) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("отправляет открытие карточки и переходы к проектам, сообществу и парку", async () => {
    const interaction = userEvent.setup();
    const fetchSpy = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).startsWith("/printers?")) {
        return new Response(JSON.stringify({ printers: extendedPrinters, has_more: false, next_cursor: null }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(null, { status: 202 });
    });
    vi.stubGlobal("fetch", fetchSpy);

    renderDetail("creality.k1-max");

    await screen.findByRole("heading", { name: "Creality K1 Max" });
    await waitFor(() =>
      expect(printerEvents(fetchSpy)).toContainEqual({
        event_name: "printer_card_view",
        props: { printer_id: "creality.k1-max", slug: "creality.k1-max", source: "direct" },
      }),
    );

    await interaction.click(screen.getByRole("button", { name: "Смотреть все проекты →" }));
    await interaction.click(screen.getByRole("button", { name: "Открыть сообщество →" }));
    await interaction.click(screen.getByRole("button", { name: "Это мой принтер" }));

    await waitFor(() => {
      expect(printerEvents(fetchSpy)).toContainEqual({
        event_name: "printer_card_click_through",
        props: { printer_id: "creality.k1-max", target: "project" },
      });
      expect(printerEvents(fetchSpy)).toContainEqual({
        event_name: "printer_card_click_through",
        props: { printer_id: "creality.k1-max", target: "community" },
      });
      expect(printerEvents(fetchSpy)).toContainEqual({
        event_name: "printer_card_click_through",
        props: { printer_id: "creality.k1-max", target: "my_printers" },
      });
    });
  });

  it("сохраняет источник «каталог» при SPA-переходе из плитки", async () => {
    const fetchSpy = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).startsWith("/printers?")) {
        return new Response(JSON.stringify({ printers: extendedPrinters, has_more: false, next_cursor: null }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(null, { status: 202 });
    });
    vi.stubGlobal("fetch", fetchSpy);
    sessionStorage.setItem("portal.printers.card.source", "catalog");

    renderDetail("creality.k1-max");

    await screen.findByRole("heading", { name: "Creality K1 Max" });
    await waitFor(() =>
      expect(printerEvents(fetchSpy)).toContainEqual({
        event_name: "printer_card_view",
        props: { printer_id: "creality.k1-max", slug: "creality.k1-max", source: "catalog" },
      }),
    );
  });
});
