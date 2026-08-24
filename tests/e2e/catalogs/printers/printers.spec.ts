import { expect, test, type Page, type Route } from "@playwright/test";

const ORIGIN = "http://127.0.0.1:5173";
const CARD_NAMES = [
  "Creality K1 Max",
  "Bambu Lab X1 Carbon",
  "Prusa MK4",
  "Voron Trident",
  "Elegoo Saturn 4 Ultra",
  "Creality K2 Plus",
  "Snapmaker J1",
  "Creality Ender-3 V2",
  "Vulcan One",
  "Nebula Zero",
];

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
}

async function installGuestFixtures(page: Page) {
  await page.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());

    if (url.origin !== ORIGIN) {
      await route.continue();
      return;
    }

    if (url.pathname === "/auth/session") {
      await json(route, { user: null });
      return;
    }

    if (url.pathname === "/me/activation" && request.method() === "GET") {
      await json(route, {
        activation: {
          state: "returning",
          has_printer: false,
          primary_persona: null,
          home_tier: "auto",
          activation_checklist: {},
          home_dismissed_prompts: {},
        },
        printers: [],
        filaments: [],
      });
      return;
    }

    await route.continue();
  });
}

async function gotoCatalog(page: Page, query = "") {
  await installGuestFixtures(page);
  await page.goto(`/printers${query}`);
  await expect(page.getByRole("button", { name: "Creality K1 Max", exact: true })).toBeVisible();
}

function searchParams(page: Page) {
  return new URL(page.url()).searchParams;
}

async function visibleCardNames(page: Page): Promise<string[]> {
  return page.locator('[role="button"][aria-label]').evaluateAll((nodes, names) => {
    const allowed = new Set(names as string[]);
    return nodes
      .map((node) => node.getAttribute("aria-label"))
      .filter((name): name is string => name != null && allowed.has(name));
  }, CARD_NAMES);
}

test.describe("каталог принтеров /printers", () => {
  test("поиск, технология и комбинация поиск+фильтр сохраняют query-state", async ({ page }) => {
    await gotoCatalog(page);

    const search = page.getByRole("textbox", { name: "Поиск по каталогу принтеров" });
    await search.fill("K1 Max");
    await expect.poll(() => searchParams(page).get("q")).toBe("K1 Max");
    await expect(page.getByRole("button", { name: "Creality K1 Max", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Bambu Lab X1 Carbon", exact: true })).toHaveCount(0);

    await page.getByRole("button", { name: "FDM", exact: true }).click();
    await expect.poll(() => searchParams(page).get("kind")).toBe("fdm");
    await expect(page.getByRole("button", { name: "Creality K1 Max", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Elegoo Saturn 4 Ultra", exact: true })).toHaveCount(0);
  });

  test("фильтр объёма детали отсекает малый стол и отражается в URL", async ({ page }) => {
    await gotoCatalog(page);

    await page.getByRole("button", { name: "≥300³", exact: true }).click();
    await expect.poll(() => searchParams(page).get("fit_x")).toBe("300");
    await expect.poll(() => searchParams(page).get("fit_y")).toBe("300");
    await expect.poll(() => searchParams(page).get("fit_z")).toBe("300");
    await expect(page.getByRole("button", { name: "Creality K1 Max", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Bambu Lab X1 Carbon", exact: true })).toHaveCount(0);
  });

  test("фильтр мультиматериала показывает AMS-модели и сохраняет capability query", async ({ page }) => {
    await gotoCatalog(page);

    await page.getByRole("button", { name: "AMS", exact: true }).click();
    await expect.poll(() => searchParams(page).get("cap")).toBe("ams");
    await expect(page.getByRole("button", { name: "Bambu Lab X1 Carbon", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Creality K2 Plus", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Creality K1 Max", exact: true })).toHaveCount(0);
  });

  test("сортировка меняет порядок карточек и сохраняет sort query", async ({ page }) => {
    await gotoCatalog(page);

    await page.getByRole("button", { name: "Сортировка: Рекомендуемые ▾", exact: true }).first().click();
    await page.getByRole("menuitem", { name: "Дешевле", exact: true }).click();

    await expect.poll(() => searchParams(page).get("sort")).toBe("cheaper");
    await expect.poll(() => visibleCardNames(page).then((names) => names[0])).toBe("Elegoo Saturn 4 Ultra");
  });

  test("переход из плитки и прямой detail URL дают карточку, неизвестный slug — 404-состояние", async ({ page }) => {
    await gotoCatalog(page);

    await page.getByRole("button", { name: "Creality K1 Max", exact: true }).click();
    await expect(page).toHaveURL(/\/printers\/creality\.k1-max$/);
    await expect(page.getByRole("heading", { name: "Creality K1 Max", exact: true })).toBeVisible();
    await expect(page.getByText("Объём печати", { exact: true })).toBeVisible();

    await page.goto("/printers/vulcan.one");
    await expect(page.getByRole("button", { name: "Уведомить о выходе", exact: true })).toBeVisible();
    await expect(page.getByText("Такого принтера у нас пока нет", { exact: true })).toHaveCount(0);

    await page.goto("/printers/does-not-exist");
    await expect(page).toHaveURL(/\/printers\/does-not-exist$/);
    await expect(page.getByText("Такого принтера у нас пока нет", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "К каталогу", exact: true })).toBeVisible();
  });

  test("пустая выдача показывает recovery action и сохраняет q", async ({ page }) => {
    await installGuestFixtures(page);
    await page.goto("/printers?q=zzzz-no-such-printer");

    await expect(page.getByText("Ничего не нашлось по этим фильтрам", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: /Снять «Поиск» \(вернёт \d+\)/ })).toBeVisible();
    await expect.poll(() => searchParams(page).get("q")).toBe("zzzz-no-such-printer");
  });

  test("пагинация каталога должна быть доступна при выдаче больше одной страницы", async ({ page }) => {
    test.fail(true, "Текущая реализация использует локальную фикстуру без API и не рендерит pagination control");
    await gotoCatalog(page);
    await expect(page.getByRole("button", { name: "Показать ещё", exact: true })).toBeVisible({ timeout: 1000 });
  });

  test("loading и error состояния требуют публичного GET /printers", async ({ page }) => {
    test.fixme(true, "В текущем dev экран загружает локальную fixture; loading/error через сетевой контракт недоступны для black-box-проверки");
    await installGuestFixtures(page);
    await page.goto("/printers");
    await expect(page.getByText("Каталог не отвечает. Обновить", { exact: true })).toBeVisible();
  });
});
