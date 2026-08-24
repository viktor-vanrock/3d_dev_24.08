import { expect, test, type Page, type Route } from "@playwright/test";

const MODEL_ID = "project-organizer-1";
const SECOND_MODEL_ID = "project-organizer-2";

type Model = {
  id: string;
  title: string;
  description: string | null;
  status: "ready";
  source_format: "3mf";
  craft: "3d_printing";
  created_at: string;
  votes_up: number;
  votes_down: number;
  downloads_count: number;
  tags: string[];
  thumb_url: string | null;
  owner: { id: string; username: string };
};

type ListRequest = {
  q: string | null;
  sort: string | null;
  tags: string[];
  cursor: string | null;
  featured: string | null;
};

type ApiCapture = {
  listRequests: ListRequest[];
  derivedRequests: string[];
};

const MODELS: Record<string, Model> = {
  [MODEL_ID]: {
    id: MODEL_ID,
    title: "Органайзер для кабелей",
    description: "Тестовый проект каталога.",
    status: "ready",
    source_format: "3mf",
    craft: "3d_printing",
    created_at: "2026-07-14T10:00:00.000Z",
    votes_up: 12,
    votes_down: 1,
    downloads_count: 4,
    tags: ["функциональный"],
    thumb_url: null,
    owner: { id: "owner-1", username: "maker" },
  },
  [SECOND_MODEL_ID]: {
    id: SECOND_MODEL_ID,
    title: "Коробка для мастерской",
    description: "Вторая тестовая карточка.",
    status: "ready",
    source_format: "3mf",
    craft: "3d_printing",
    created_at: "2026-07-13T10:00:00.000Z",
    votes_up: 4,
    votes_down: 0,
    downloads_count: 2,
    tags: ["мастерская"],
    thumb_url: null,
    owner: { id: "owner-2", username: "builder" },
  },
};

const DETAIL = {
  ...MODELS[MODEL_ID],
  publish_status: "published" as const,
  bbox: null,
  size_bytes: 2048,
  my_vote: 0 as const,
  make_stats: { makes_count: 0, machines_count: 0, materials_count: 0, avg_printability_rating: null },
  top_combos: [],
  preview_url: null,
  preview_mobile_url: null,
  download_url: null,
  files: [],
  repo_url: null,
  recommended_material: null,
  owner: { ...MODELS[MODEL_ID].owner, display_name: "Maker", avatar_url: null },
  comments_count: 0,
  views_count: 0,
};

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
}

function listResponse(url: URL) {
  const q = url.searchParams.get("q");
  const tags = url.searchParams.getAll("tag");
  const cursor = url.searchParams.get("cursor");

  if (q === "ошибка") return { error: "upstream_unavailable" };
  if (q === "неттакого") return { models: [], has_more: false, next_cursor: null };
  if (cursor === "cursor-page-2") {
    return {
      models: [{ ...MODELS[SECOND_MODEL_ID], title: "Страница 2 — коробка для мастерской" }],
      has_more: false,
      next_cursor: null,
    };
  }
  if (q === "органайзер" && tags.includes("функциональный")) {
    return {
      models: [{ ...MODELS[MODEL_ID], title: "Комбинированный органайзер" }],
      has_more: false,
      next_cursor: null,
    };
  }
  if (q === "органайзер") {
    return {
      models: [{ ...MODELS[MODEL_ID], title: "Органайзер по запросу" }],
      has_more: false,
      next_cursor: null,
    };
  }
  return {
    models: [MODELS[MODEL_ID], MODELS[SECOND_MODEL_ID]],
    has_more: true,
    next_cursor: "cursor-page-2",
  };
}

async function installApiFixtures(page: Page): Promise<ApiCapture> {
  const capture: ApiCapture = { listRequests: [], derivedRequests: [] };

  await page.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== "http://127.0.0.1:5173") {
      await route.continue();
      return;
    }

    if (url.pathname === "/auth/session") {
      await json(route, { user: null });
      return;
    }
    if (url.pathname === "/me/activation") {
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
    if (url.pathname === "/tags") {
      await json(route, { tags: ["функциональный", "мастерская"] });
      return;
    }
    if (url.pathname === "/models" && request.method() === "GET") {
      capture.listRequests.push({
        q: url.searchParams.get("q"),
        sort: url.searchParams.get("sort"),
        tags: url.searchParams.getAll("tag"),
        cursor: url.searchParams.get("cursor"),
        featured: url.searchParams.get("featured"),
      });
      const body = listResponse(url);
      await json(route, body, "error" in body ? 503 : 200);
      return;
    }
    if (url.pathname === `/models/${MODEL_ID}` && request.method() === "GET") {
      await json(route, { model: DETAIL });
      return;
    }
    if (url.pathname === `/models/${MODEL_ID}/comments`) {
      capture.derivedRequests.push(url.pathname);
      await json(route, { items: [] });
      return;
    }
    if (url.pathname === `/models/${MODEL_ID}/tree` || url.pathname === `/models/${MODEL_ID}/history`) {
      capture.derivedRequests.push(url.pathname);
      await json(route, url.pathname.endsWith("/tree") ? { source: "fallback", entries: [] } : { source: "fallback", commits: [] });
      return;
    }
    if (url.pathname.startsWith("/models/") && request.method() === "GET") {
      await json(route, { error: "not_found" }, 404);
      return;
    }
    await route.continue();
  });

  return capture;
}

function query(page: Page) {
  return new URL(page.url()).searchParams;
}

test.describe("каталог проектов и поисковая выдача", () => {
  test("листинг, релевантный q, фильтр и комбинация q+filter сохраняют query-state", async ({ page }) => {
    const api = await installApiFixtures(page);
    await page.goto("/market");

    await expect(page.getByRole("textbox", { name: "Найти проект" })).toBeVisible();
    await expect(page.getByRole("button", { name: /^Органайзер для кабелей @maker/ })).toBeVisible();

    const search = page.getByRole("textbox", { name: "Найти проект" });
    await search.fill("органайзер");
    await expect.poll(() => query(page).get("q")).toBe("органайзер");
    await expect(page.getByRole("button", { name: /^Органайзер по запросу @maker/ })).toBeVisible();

    await page.getByRole("button", { name: "функциональный", exact: true }).click();
    await expect.poll(() => query(page).getAll("tag")).toEqual(["функциональный"]);
    await expect(page.getByRole("button", { name: /^Комбинированный органайзер @maker/ })).toBeVisible();

    await page.getByRole("tab", { name: "Популярные" }).click();
    await expect.poll(() => query(page).get("sort")).toBe("popular");
    await expect.poll(() =>
      api.listRequests.some(
        (request) => request.q === "органайзер" && request.sort === "popular" && request.tags.includes("функциональный"),
      ),
    ).toBe(true);
  });

  test("пагинация передаёт opaque cursor и добавляет следующую страницу", async ({ page }) => {
    const api = await installApiFixtures(page);
    await page.goto("/market");

    await expect(page.getByRole("button", { name: "Показать ещё" })).toBeVisible();
    await page.getByRole("button", { name: "Показать ещё" }).click();
    await expect(page.getByText("Страница 2 — коробка для мастерской", { exact: true })).toBeVisible();
    await expect.poll(() => api.listRequests.some((request) => request.cursor === "cursor-page-2")).toBe(true);
  });

  test("пустая и ошибочная выдача показывают честные состояния", async ({ page }) => {
    await installApiFixtures(page);
    await page.goto("/market");
    const search = page.getByRole("textbox", { name: "Найти проект" });

    await search.fill("неттакого");
    await expect(page.getByText("Ничего не нашлось", { exact: true })).toBeVisible();
    await expect.poll(() => query(page).get("q")).toBe("неттакого");

    await search.fill("ошибка");
    await expect(page.getByText("Не удалось загрузить каталог. Проверьте связь.", { exact: true })).toBeVisible();
    await expect.poll(() => query(page).get("q")).toBe("ошибка");
  });

  test("переход из результата открывает detail, а прямой URL неизвестного проекта даёт 404", async ({ page }) => {
    const api = await installApiFixtures(page);
    await page.goto("/market");
    await page.getByRole("button", { name: /^Органайзер для кабелей @maker/ }).click();

    await expect(page).toHaveURL(/\/project\/project-organizer-1$/);
    await expect(page.getByRole("heading", { name: "Органайзер для кабелей" })).toBeVisible();
    await expect(page.getByText("Пока никто не обсуждал", { exact: true })).toBeVisible();
    await expect.poll(() => [...new Set(api.derivedRequests)].sort()).toEqual([
      "/models/project-organizer-1/comments",
      "/models/project-organizer-1/history",
      "/models/project-organizer-1/tree",
    ]);

    await page.goto("/project/project-does-not-exist");
    await expect(page.getByText("Проект не найден", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "В каталог", exact: true })).toBeVisible();
    expect(api.derivedRequests).not.toContain("/models/project-does-not-exist/tree");
    expect(api.derivedRequests).not.toContain("/models/project-does-not-exist/history");
  });

  test("back/forward восстанавливают комбинацию q+filter и detail", async ({ page }) => {
    await installApiFixtures(page);
    await page.goto("/market?q=органайзер");

    await page.getByRole("button", { name: "функциональный", exact: true }).click();
    await expect(page.getByRole("button", { name: /^Комбинированный органайзер @maker/ })).toBeVisible();
    await page.getByRole("button", { name: /^Комбинированный органайзер @maker/ }).click();
    await expect(page).toHaveURL(/\/project\/project-organizer-1$/);

    await page.goBack();
    await expect(page).toHaveURL(/\/market/);
    await expect.poll(() => query(page).get("q")).toBe("органайзер");
    await expect.poll(() => query(page).getAll("tag")).toEqual(["функциональный"]);
    await expect(page.getByRole("textbox", { name: "Найти проект" })).toHaveValue("органайзер");
    await expect(page.getByRole("button", { name: /^Комбинированный органайзер @maker/ })).toBeVisible();

    await page.goForward();
    await expect(page).toHaveURL(/\/project\/project-organizer-1$/);
    await expect(page.getByRole("heading", { name: "Органайзер для кабелей" })).toBeVisible();
  });
});
