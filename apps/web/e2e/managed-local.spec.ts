import { expect, test, type Page } from "@playwright/test";

const PORTAL_ORIGIN = "http://127.0.0.1:5173";
const LAN_ORIGIN = "http://192.168.1.42:7125";
const LAN_ADDRESS = "192.168.1.42";
const LAN_ENDPOINT = `${LAN_ADDRESS}:7125`;
const LAN_INFO_URL = `${LAN_ORIGIN}/printer/info`;
const EXPECTED_LAN_PROBE = { url: LAN_INFO_URL, method: "GET" as const, resourceType: "fetch" as const };
// MF-1843 (MF-1841 §2.2.5): detail-экран больше не бьёт напрямую в LAN IP — HTTPS mixed content
// блокирует этот путь (MF-1835); браузер обращается к loopback-helper, тот сам делает LAN-запрос.
// Порт/путь дублируют `loopbackHelperUrl` (src/park/livesource.ts) — не импортируются напрямую,
// т.к. этот файл выполняется вне Vite (`import.meta.env` там недоступен).
const HELPER_URL = "http://127.0.0.1:8943/probe?target=" + encodeURIComponent(LAN_ENDPOINT);
const HELPER_ORIGIN = new URL(HELPER_URL).origin;
const USER = {
  id: "e2e-user",
  username: "e2e-maker",
  display_name: null,
  avatar_url: null,
  handle_confirmed: true,
  role: "user",
};

type PrinterFixture = {
  id: string;
  brand: string;
  model: string;
  is_primary: boolean;
  verified: boolean;
  link_source: "ip";
  lan_endpoint: string;
};

type HelperBehavior = "ready" | "connection-refused" | "lan-probe-failed";

type RequestCapture = {
  apiUrls: string[];
  apiBodies: string[];
  apiRequests: Array<{ url: string; method: string; body: string }>;
  lanUrls: string[];
  lanRequests: Array<{ url: string; method: string; resourceType: string }>;
  helperUrls: string[];
};

async function installManagedLocalFixtures(
  page: Page,
  printers: PrinterFixture[],
  helperBehavior: HelperBehavior = "ready",
): Promise<RequestCapture> {
  const capture: RequestCapture = {
    apiUrls: [],
    apiBodies: [],
    apiRequests: [],
    lanUrls: [],
    lanRequests: [],
    helperUrls: [],
  };

  page.on("request", (request) => {
    const url = request.url();
    if (url.startsWith(PORTAL_ORIGIN)) {
      capture.apiUrls.push(url);
      const postData = request.postData();
      if (postData) capture.apiBodies.push(postData);
      capture.apiRequests.push({ url, method: request.method(), body: postData ?? "" });
    }
    if (url.startsWith(LAN_ORIGIN)) {
      capture.lanUrls.push(url);
      capture.lanRequests.push({ url, method: request.method(), resourceType: request.resourceType() });
    }
    if (url.startsWith(HELPER_ORIGIN)) capture.helperUrls.push(url);
  });

  await page.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const json = (body: unknown, status = 200) =>
      route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

    // Только для проверки IP-адреса в мастере добавления (ipcheck.ts) — вне scope MF-1843,
    // тот шаг по-прежнему бьёт напрямую в LAN (известное ограничение, задокументировано в
    // ipcheck.ts, не решается этой карточкой).
    if (url.origin === LAN_ORIGIN) {
      if (request.method() !== "GET" || url.pathname !== "/printer/info") {
        throw new Error(`managed-local browser probe must use GET /printer/info, got ${request.method()} ${url.pathname}`);
      }
      await json({ result: { state: "ready" } });
      return;
    }

    if (url.origin === HELPER_ORIGIN) {
      if (helperBehavior === "connection-refused") {
        await route.abort("connectionrefused");
        return;
      }
      if (helperBehavior === "lan-probe-failed") {
        // Helper отвечает — соединение к loopback установилось, но его собственный LAN-запрос к
        // принтеру не удался. Это `direct timeout/error`, не `helper unavailable`.
        await json({});
        return;
      }
      await json({ result: { state: "ready" } });
      return;
    }

    if (url.origin !== PORTAL_ORIGIN) {
      await route.continue();
      return;
    }

    if (/\/(proxy|relay)(\/|\?|$)/.test(url.pathname)) {
      throw new Error(`managed-local must not use server proxy routes: ${url.pathname}`);
    }

    if (url.pathname === "/auth/session") {
      await json({ user: USER });
      return;
    }

    if (url.pathname === "/me/activation" && request.method() === "GET") {
      await json({
        activation: {
          state: "returning",
          has_printer: printers.length > 0,
          primary_persona: null,
          home_tier: "auto",
          activation_checklist: {},
          home_dismissed_prompts: {},
        },
        printers,
        filaments: [],
      });
      return;
    }

    if (url.pathname === "/me/printers" && request.method() === "POST") {
      await json({
        printer: printers[0] ?? {
          id: "managed-local-1",
          brand: "Creality",
          model: "Ender-3 V3 KE",
          is_primary: false,
          verified: false,
          link_source: "ip",
          lan_endpoint: LAN_ENDPOINT,
        },
      }, 201);
      return;
    }

    if (url.pathname === "/me/printers" && request.method() === "GET") {
      await json({ printers });
      return;
    }

    if (url.pathname === "/printers" && request.method() === "GET") {
      await json({
        printers: [
          {
            slug: "creality.ender-3-v3-ke",
            brand: "Creality",
            model: "Ender-3 V3 KE",
            connector_type: "moonraker",
            firmware_ready: false,
            firmware_public: false,
          },
        ],
      });
      return;
    }

    if (url.pathname === "/printers/creality.ender-3-v3-ke") {
      await json({
        slug: "creality.ender-3-v3-ke",
        brand: "Creality",
        model: "Ender-3 V3 KE",
        connector_type: "moonraker",
        firmware_ready: false,
        firmware_public: false,
      });
      return;
    }

    if (url.pathname.endsWith("/live")) {
      await json({
        live: true,
        state: "ready",
        connection_mode: "managed-local",
        live_availability_reason: "available",
      });
      return;
    }

    await route.continue();
  });

  return capture;
}

function assertNoServerLanProxy(capture: RequestCapture) {
  expect(capture.apiUrls.some((url) => url.startsWith(LAN_ORIGIN))).toBe(false);
  expect(capture.apiUrls.some((url) => url.startsWith(HELPER_ORIGIN))).toBe(false);
  expect(capture.apiUrls.some((url) => decodeURIComponent(url).includes(LAN_ADDRESS))).toBe(false);
  expect(capture.apiUrls.some((url) => /\/(proxy|relay)(\/|\?|$)/.test(new URL(url).pathname))).toBe(false);
  expect(capture.apiBodies.some((body) => /"(?:proxy|relay)(?:_url)?"\s*:/.test(body))).toBe(false);
  expect(capture.apiRequests
    .filter(({ body }) => body.includes(LAN_ADDRESS))
    .every(({ url, method }) => url === `${PORTAL_ORIGIN}/me/printers` && method === "POST"))
    .toBe(true);
}

// Detail-экран (MF-1843): browser обращается только к loopback-helper, ни разу напрямую к LAN IP,
// и сервер ни разу не видит LAN-адрес.
function assertHelperOnly(capture: RequestCapture) {
  expect(capture.helperUrls).toEqual([HELPER_URL]);
  expect(capture.lanUrls).toEqual([]);
  assertNoServerLanProxy(capture);
}

function assertLanAddressIsOwnerScoped(capture: RequestCapture) {
  const lanRequests = capture.apiRequests.filter(({ body }) => body.includes(LAN_ADDRESS));

  expect(lanRequests).toHaveLength(1);
  expect(lanRequests[0]).toMatchObject({
    url: `${PORTAL_ORIGIN}/me/printers`,
    method: "POST",
  });
  expect(JSON.parse(lanRequests[0]!.body)).toMatchObject({
    link_source: "ip",
    lan_endpoint: LAN_ADDRESS,
  });
}

const DETAIL_PRINTER: PrinterFixture = {
  id: "managed-local-1",
  brand: "Creality",
  model: "Ender-3 V3 KE",
  is_primary: true,
  verified: true,
  link_source: "ip",
  lan_endpoint: LAN_ENDPOINT,
};

test.describe("managed-local: browser-only transport", () => {
  test("ввод адреса и проба идут из /park/add напрямую в LAN fixture", async ({ page }) => {
    const capture = await installManagedLocalFixtures(page, []);

    await page.goto("/park/add?brand=Creality&model=Ender-3%20V3%20KE");
    await expect(page.getByRole("heading", { name: "Что вы хотите делать с принтером?" })).toBeVisible();

    const localLevel = page.getByRole("radio", { name: /Управлять, пока дома/ });
    await expect(localLevel).toBeEnabled();
    await localLevel.click();
    await page.getByRole("textbox", { name: "IP-адрес принтера" }).fill(LAN_ADDRESS);
    await page.getByRole("button", { name: "Проверить" }).click();

    await expect(page.getByText("Принтер найден")).toBeVisible();
    await page.getByRole("button", { name: "Добавить в парк" }).click();
    await expect(page.getByRole("heading", { name: "Готово" })).toBeVisible();

    expect(capture.apiBodies.some((body) => body.includes('"link_source":"ip"'))).toBe(true);
    assertLanAddressIsOwnerScoped(capture);
    expect(capture.lanUrls).toEqual([EXPECTED_LAN_PROBE.url]);
    expect(capture.lanRequests).toEqual([EXPECTED_LAN_PROBE]);
    assertNoServerLanProxy(capture);
  });

  test("список /park не создаёт server→LAN request для live-виджета", async ({ page }) => {
    const capture = await installManagedLocalFixtures(page, [DETAIL_PRINTER]);

    await page.goto("/park");
    await expect(page.getByRole("heading", { name: "Мой парк" })).toBeVisible();
    await expect(page.getByText("1 принтер · 0 печатает · 1 на связи")).toBeVisible();

    expect(capture.lanRequests).toEqual([]);
    expect(capture.helperUrls).toEqual([]);
    expect(capture.apiRequests.filter(({ url }) => url === `${PORTAL_ORIGIN}/me/printers/managed-local-1/live`)).toEqual([
      { url: `${PORTAL_ORIGIN}/me/printers/managed-local-1/live`, method: "GET", body: "" },
    ]);
    assertNoServerLanProxy(capture);
  });

  test("detail /printer/:id показывает только локальный read-only факт без control CTA", async ({ page }) => {
    const capture = await installManagedLocalFixtures(page, [DETAIL_PRINTER], "ready");

    await page.goto("/printer/managed-local-1");

    await expect(page.getByRole("heading", { level: 1, name: "Только просмотр" })).toBeVisible();
    await expect(page.getByText("Источник: локальный запрос")).toBeVisible();
    await expect(page.getByRole("button", { name: "Старт" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Пауза" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Стоп" })).toHaveCount(0);

    expect(capture.apiRequests.filter(({ url }) => url.endsWith("/live"))).toEqual([]);
    assertHelperOnly(capture);
  });

  test("MF-1843: detail /printer/:id показывает helper unavailable, когда loopback-соединение не устанавливается", async ({ page }) => {
    const capture = await installManagedLocalFixtures(page, [DETAIL_PRINTER], "connection-refused");

    await page.goto("/printer/managed-local-1");

    await expect(page.getByRole("heading", { level: 1, name: "Локальный helper не обнаружен" })).toBeVisible();
    await expect(page.getByText("Источник: локальный helper")).toBeVisible();
    await expect(page.getByText("Проверка ограничена этим устройством")).toBeVisible();
    await expect(page.getByRole("button", { name: "Установить локальный helper" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Повторить проверку" })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Не удалось проверить локальный принтер" })).toHaveCount(0);

    expect(capture.apiRequests.filter(({ url }) => url.endsWith("/live"))).toEqual([]);
    assertNoServerLanProxy(capture);
    expect(capture.lanUrls).toEqual([]);
  });

  test("MF-1843: detail /printer/:id остаётся direct timeout/error, когда helper ответил своей ошибкой LAN-пробы", async ({ page }) => {
    const capture = await installManagedLocalFixtures(page, [DETAIL_PRINTER], "lan-probe-failed");

    await page.goto("/printer/managed-local-1");

    await expect(page.getByRole("heading", { level: 1, name: "Не удалось проверить локальный принтер" })).toBeVisible();
    await expect(page.getByText("Источник: ошибка локального запроса")).toBeVisible();
    await expect(page.getByRole("button", { name: "Повторить проверку" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Локальный helper не обнаружен" })).toHaveCount(0);

    assertNoServerLanProxy(capture);
    expect(capture.lanUrls).toEqual([]);
    expect(capture.helperUrls).toEqual([HELPER_URL]);
  });
});
