import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  addModelPath,
  assistantChatsPath,
  assistantWorkshopPath,
  avatarEditorPath,
  communitiesPath,
  communityPath,
  feedNewPath,
  feedPath,
  feedPostPath,
  filamentsPath,
  generatePath,
  headerModeFor,
  issueNewPath,
  legacyHashToPath,
  makesPath,
  marketPath,
  marketSearch,
  materialPath,
  materialsPath,
  modelPath,
  parkAddPath,
  parseIssueNewContext,
  parseLocation,
  parseParkAddPrefill,
  platePath,
  printerCommunityFirmwarePath,
  printerComparePath,
  printerDiyPath,
  printerPath,
  printersPath,
  projectBuildPath,
  projectStudioPath,
  researchFormPath,
  researchNewPath,
  researchPath,
  threadPath,
  useRoute,
} from "./router.ts";

// Path-роутер «Проектов» (MF-524): витрина на `/project` (+ `/project/:id`), редиректы со старых
// hash-ссылок `#/market...`. Проверяем разбор пути и миграцию легаси-hash.

describe("marketPath/marketSearch (MF-347, шэрабельные фильтры каталога проектов)", () => {
  it("без фильтров → голый /project", () => {
    expect(marketPath()).toBe("/project");
    expect(marketSearch()).toBe("");
  });

  it("q + sort не-default → query string", () => {
    expect(marketPath({ q: "vase", sort: "popular" })).toBe("/project?q=vase&sort=popular");
  });

  it("sort=new (default) не попадает в query", () => {
    expect(marketPath({ sort: "new" })).toBe("/project");
  });

  it("round-trip: marketPath → parseLocation восстанавливает те же фильтры", () => {
    const path = marketPath({ tag: "vase", q: "dragon", sort: "popular" });
    const [pathname, search = ""] = path.split("?");
    expect(parseLocation(pathname ?? "", `?${search}`)).toEqual({ screen: "market", tag: "vase", q: "dragon", sort: "popular" });
  });
});

describe("parseLocation", () => {
  it("opens the standalone avatar builder", () => {
    expect(parseLocation("/avatar", "")).toEqual({ screen: "avatar-editor" });
  });
  it("возврат из оплаты открывает экран статуса покупки", () => {
    expect(parseLocation("/purchases/p-1", "")).toEqual({ screen: "purchase-return", id: "p-1" });
  });
  it("корень → home", () => {
    expect(parseLocation("/", "")).toEqual({ screen: "home" });
  });

  it("/legal/:slug → публичная юридическая страница с декодированным slug", () => {
    expect(parseLocation("/legal/license", "")).toEqual({ screen: "legal", slug: "license" });
    expect(parseLocation("/legal/privacy", "")).toEqual({ screen: "legal", slug: "privacy" });
    expect(parseLocation("/legal/terms", "")).toEqual({ screen: "legal", slug: "terms" });
  });

  it("ссылки подвала /communities и /profile ведут в существующие разделы", () => {
    expect(parseLocation("/communities", "")).toEqual({ screen: "communities" });
    expect(parseLocation("/profile", "")).toEqual({ screen: "own-profile" });
  });

  it("/profile/avatar открывает отдельную мастерскую персонажа", () => {
    expect(avatarEditorPath()).toBe("/profile/avatar");
    expect(parseLocation(avatarEditorPath(), "")).toEqual({ screen: "avatar-editor" });
  });

  it("/project → market без тега", () => {
    expect(parseLocation("/project", "")).toEqual({ screen: "market", tag: undefined });
  });

  it("/project?tag=x → market с тегом", () => {
    expect(parseLocation("/project", "?tag=vase")).toEqual({ screen: "market", tag: "vase" });
  });

  it("/project?q=x → market с поисковым запросом (deep-link из домашнего поиска)", () => {
    expect(parseLocation("/project", "?q=дракон")).toEqual({ screen: "market", q: "дракон", tag: undefined });
  });

  it("/market?search=x → каталог с поиском для внешнего deep-link", () => {
    expect(parseLocation("/market", "?search=zzzz-no-results")).toEqual({
      screen: "market",
      q: "zzzz-no-results",
      tag: undefined,
    });
  });

  it("/project?q=x&sort=popular → market с поиском и сортировкой (MF-347, шэрабельные фильтры)", () => {
    expect(parseLocation("/project", "?q=vase&sort=popular")).toEqual({
      screen: "market",
      q: "vase",
      sort: "popular",
    });
  });

  it("/project?sort=bogus → неизвестная сортировка отбрасывается", () => {
    expect(parseLocation("/project", "?sort=bogus")).toEqual({ screen: "market" });
  });

  it("/project/:id → карточка модели (id декодируется)", () => {
    expect(parseLocation("/project/abc%20123", "")).toEqual({ screen: "model", id: "abc 123", tab: undefined });
  });

  it("/project/add → флоу «Добавить модель» (MF-476), не читается как id модели", () => {
    expect(parseLocation("/project/add", "")).toEqual({ screen: "add" });
  });

  it("/project/:id/comments|makes|stats → карточка модели с активной вкладкой (MF-476)", () => {
    expect(parseLocation("/project/42/comments", "")).toEqual({ screen: "model", id: "42", tab: "comments" });
    expect(parseLocation("/project/42/makes", "")).toEqual({ screen: "model", id: "42", tab: "makes" });
    expect(parseLocation("/project/42/stats", "")).toEqual({ screen: "model", id: "42", tab: "stats" });
  });

  it("/project/:id/build → личная сборочная сессия с выбранной конфигурацией", () => {
    expect(parseLocation("/project/lerobotdepot/build", "?config=so101-follower")).toEqual({
      screen: "project-build",
      id: "lerobotdepot",
      config: "so101-follower",
    });
  });

  it("/project/:id/whatever → неизвестная вкладка игнорируется (tab: undefined)", () => {
    expect(parseLocation("/project/42/whatever", "")).toEqual({ screen: "model", id: "42", tab: undefined });
  });

  it("/u/:username → профиль", () => {
    expect(parseLocation("/u/plag", "")).toEqual({ screen: "profile", username: "plag" });
  });

  it("/kitchen-sink → стенд ui", () => {
    expect(parseLocation("/kitchen-sink", "")).toEqual({ screen: "kitchen-sink" });
  });

  it("/face → морда принтера (MF-926)", () => {
    expect(parseLocation("/face", "")).toEqual({ screen: "printer-face" });
  });

  it("/internal/catalog-metrics → дашборд покрытия каталога", () => {
    expect(parseLocation("/internal/catalog-metrics", "")).toEqual({ screen: "catalog-metrics" });
  });

  it("/internal/product-health → дашборд здоровья продукта (MF-733)", () => {
    expect(parseLocation("/internal/product-health", "")).toEqual({ screen: "product-health" });
  });

  it("/generate → генерация без id", () => {
    expect(parseLocation("/generate", "")).toEqual({ screen: "generate", genId: undefined });
  });

  it("/generate?gen=:id → генерация с подхватом job'а (docs/design/generation.md §1)", () => {
    expect(parseLocation("/generate", "?gen=abc-123")).toEqual({ screen: "generate", genId: "abc-123" });
  });

  it("Giga имеет канонические маршруты и сохраняет старые ссылки", () => {
    expect(assistantChatsPath()).toBe("/giga");
    expect(parseLocation("/giga", "")).toEqual({ screen: "assistant-chats" });
    expect(parseLocation("/chats", "")).toEqual({ screen: "assistant-chats" });
    expect(assistantWorkshopPath("thread с пробелом")).toBe("/giga/thread%20%D1%81%20%D0%BF%D1%80%D0%BE%D0%B1%D0%B5%D0%BB%D0%BE%D0%BC");
    expect(parseLocation("/giga/thread%20one", "")).toEqual({
      screen: "assistant-workshop",
      threadId: "thread one",
    });
    expect(parseLocation("/workshop/3d/thread%20one", "")).toEqual({
      screen: "assistant-workshop",
      threadId: "thread one",
    });
  });

  it("неизвестный путь → home (фолбэк)", () => {
    expect(parseLocation("/whatever", "")).toEqual({ screen: "home" });
  });

  it("/makes → галерея Make (MF-777)", () => {
    expect(parseLocation("/makes", "")).toEqual({ screen: "makes" });
  });

  it("/makes/:id → детальная страница Make", () => {
    expect(parseLocation("/makes/make-public-id", "")).toEqual({ screen: "make", id: "make-public-id" });
  });

  it("/feed → лента (MF-816)", () => {
    expect(parseLocation("/feed", "")).toEqual({ screen: "feed" });
  });

  it("/news → тот же экран ленты как алиас раздела «Новости»", () => {
    expect(parseLocation("/news", "")).toEqual({ screen: "feed" });
    expect(parseLocation("/news", "?scope=subscribed")).toEqual({ screen: "feed", scope: "subscribed" });
  });

  it("/feed?community=:slug → лента конкретного саба", () => {
    expect(parseLocation("/feed", "?community=bambu-lab-fanaty")).toEqual({
      screen: "feed",
      community: "bambu-lab-fanaty",
    });
  });

  it("/feed/p/:id → страница поста (id декодируется)", () => {
    expect(parseLocation("/feed/p/abc%20123", "")).toEqual({ screen: "feed-post", id: "abc 123" });
  });

  it("/feed/new → редактор, ДО общего /feed/p/:id (тот же приём, что /project/add)", () => {
    expect(parseLocation("/feed/new", "")).toEqual({ screen: "feed-new", model: undefined });
  });

  it("/feed/new?model=:id → предзаполнение вложения модели (§2.1 feed.post.editor.md)", () => {
    expect(parseLocation("/feed/new", "?model=42")).toEqual({ screen: "feed-new", model: "42" });
  });

  it("/printers → фасетный каталог (MF-927)", () => {
    expect(parseLocation("/printers", "")).toEqual({ screen: "printers", view: undefined });
  });

  it("/materials → публичный каталог материалов", () => {
    expect(parseLocation("/materials", "?q=PLA&kind=filament")).toEqual({ screen: "materials" });
  });

  it("/materials/:id → карточка материала с декодированным id", () => {
    expect(parseLocation("/materials/abc%20123", "")).toEqual({ screen: "material", id: "abc 123" });
  });

  it("/printers?view=new → сегмент «Новинки» в URL (MF-927 §1.1)", () => {
    expect(parseLocation("/printers", "?view=new")).toEqual({ screen: "printers", view: "new" });
  });

  it("/printers/<slug> → карточка принтера (MF-927 §4)", () => {
    expect(parseLocation("/printers/creality.k1-max", "")).toEqual({ screen: "printer", slug: "creality.k1-max" });
  });

  it("/materials/:id → детальная карточка материала, query каталога не меняет id", () => {
    expect(parseLocation("/materials/abc%20123", "?q=pla&kind=filament")).toEqual({ screen: "material", id: "abc 123" });
  });

  it("/printers/compare?ids=… → сравнение (MF-927, nav.sections.md §3.5)", () => {
    expect(parseLocation("/printers/compare", "?ids=a,b,c")).toEqual({ screen: "printer-compare", ids: ["a", "b", "c"] });
  });

  it("/printer/:id → живая страница СВОЕГО устройства (MF-953), не путать с каталожным /printers/:slug", () => {
    expect(parseLocation("/printer/a1b2c3", "")).toEqual({ screen: "printer-device", id: "a1b2c3" });
  });

  it("/printer/ без id → явное состояние «Принтер не найден», а не домашняя страница (MF-1367)", () => {
    expect(parseLocation("/printer/", "")).toEqual({ screen: "printer-device-missing" });
  });

  it("/park/add → мастер «добавить принтер» (MF-903)", () => {
    expect(parseLocation("/park/add", "")).toEqual({ screen: "park-add" });
  });

  it("/printers/:id/diy → «Сделать самому», ДО общей карточки принтера (MF-903 §5)", () => {
    expect(parseLocation("/printers/ender-3-v3-se", "")).toEqual({ screen: "printer", slug: "ender-3-v3-se" });
    expect(parseLocation("/printers/ender-3-v3-se/diy", "")).toEqual({ screen: "printer-diy", printerId: "ender-3-v3-se" });
  });

  it("/printers/:id/community-firmware → «Прошивки сообщества» (MF-903 §5)", () => {
    expect(parseLocation("/printers/ender-3-v3-se/community-firmware", "")).toEqual({
      screen: "printer-community-firmware",
      printerId: "ender-3-v3-se",
    });
  });

  it("/community → список сообществ (community.md §0, MF-931)", () => {
    expect(parseLocation("/community", "")).toEqual({ screen: "communities" });
  });

  it("/community/:slug → страница сообщества, slug декодируется", () => {
    expect(parseLocation("/community/bambu%20lab", "")).toEqual({ screen: "community", slug: "bambu lab" });
  });

  it("/thread/:id → страница треда, id декодируется", () => {
    expect(parseLocation("/thread/abc%20123", "")).toEqual({ screen: "thread", id: "abc 123" });
  });

  it("/moderation → защищённая очередь модерации", () => {
    expect(parseLocation("/moderation", "")).toEqual({ screen: "moderation" });
  });

  it("/issue/new → форма подачи идеи (MF-947), не читается как id=\"new\"", () => {
    expect(parseLocation("/issue/new", "")).toEqual({ screen: "issue-new" });
  });

  it("/issue/:id → страница идеи, id декодируется", () => {
    expect(parseLocation("/issue/abc%20123", "")).toEqual({ screen: "idea", id: "abc 123" });
  });
});

describe("makesPath (MF-777)", () => {
  it("→ /makes", () => {
    expect(makesPath()).toBe("/makes");
  });
});

describe("printersPath (MF-851)", () => {
  it("→ /printers", () => {
    expect(printersPath()).toBe("/printers");
  });
});

describe("materialsPath / materialPath (MF-1476)", () => {
  it("строят канонические адреса каталога и detail", () => {
    expect(materialsPath()).toBe("/materials");
    expect(filamentsPath()).toBe("/materials?kind=filament");
    expect(materialPath("abc 123")).toBe("/materials/abc%20123");
  });
});

describe("platePath / parseLocation('/plate') (MF-1094)", () => {
  it("без модели → голый /plate, парсится обратно без modelId", () => {
    expect(platePath()).toBe("/plate");
    expect(parseLocation("/plate", "")).toEqual({ screen: "plate", modelId: undefined });
  });

  it("с моделью → ?model=, парсится обратно с тем же id", () => {
    const path = platePath("model 1");
    expect(path).toBe("/plate?model=model%201");
    const [pathname, search = ""] = path.split("?");
    expect(parseLocation(pathname ?? "", `?${search}`)).toEqual({ screen: "plate", modelId: "model 1" });
  });

  it("из шага проекта сохраняет immutable artifact и step в deep-link", () => {
    const path = platePath("so-arm100", { artifactId: "gauge-tight", stepId: "print-gauges" });
    expect(path).toBe("/plate?model=so-arm100&artifact=gauge-tight&step=print-gauges");
    const [pathname, search = ""] = path.split("?");
    expect(parseLocation(pathname ?? "", `?${search}`)).toEqual({
      screen: "plate",
      modelId: "so-arm100",
      artifactId: "gauge-tight",
      stepId: "print-gauges",
    });
  });
});

describe("printerPath / printerComparePath (MF-927)", () => {
  it("printerPath кодирует slug", () => {
    expect(printerPath("creality.k1-max")).toBe("/printers/creality.k1-max");
  });

  it("printerComparePath собирает ids через запятую", () => {
    expect(printerComparePath(["a", "b", "c"])).toBe("/printers/compare?ids=a,b,c");
  });
});

describe("parkAddPath / parseParkAddPrefill / printerDiyPath / printerCommunityFirmwarePath (MF-903)", () => {
  it("parkAddPath без префилла → /park/add", () => {
    expect(parkAddPath()).toBe("/park/add");
  });

  it("parkAddPath с префиллом → query с brand/model(/machine_id)", () => {
    expect(parkAddPath({ brand: "Creality", model: "Ender-3 V3 KE" })).toBe(
      "/park/add?brand=Creality&model=Ender-3+V3+KE",
    );
    expect(parkAddPath({ brand: "Creality", model: "Ender-3 V3 KE", machineId: "abc 1" })).toBe(
      "/park/add?brand=Creality&model=Ender-3+V3+KE&machine_id=abc+1",
    );
  });

  it("parseParkAddPrefill читает brand/model/machine_id обратно, round-trip", () => {
    const path = parkAddPath({ brand: "Creality", model: "Ender-3 V3 KE", machineId: "abc 1" });
    const search = path.slice(path.indexOf("?"));
    expect(parseParkAddPrefill(search)).toEqual({ brand: "Creality", model: "Ender-3 V3 KE", machineId: "abc 1" });
  });

  it("parseParkAddPrefill принимает printer_id из resume deep-link", () => {
    expect(parseParkAddPrefill("?brand=Creality&model=Ender-3+V3+KE&printer_id=abc-1&return_to=%2Fprinters%2Fabc-1")).toEqual({
      brand: "Creality",
      model: "Ender-3 V3 KE",
      machineId: "abc-1",
      returnTo: "/printers/abc-1",
      source: undefined,
    });
  });

  it("parseParkAddPrefill без brand/model → undefined (шаг 1 не пропускаем без обоих полей)", () => {
    expect(parseParkAddPrefill("")).toBeUndefined();
    expect(parseParkAddPrefill("?brand=Creality")).toBeUndefined();
  });

  it("printerDiyPath / printerCommunityFirmwarePath кодируют id", () => {
    expect(printerDiyPath("ender-3 v3 se")).toBe("/printers/ender-3%20v3%20se/diy");
    expect(printerCommunityFirmwarePath("ender-3 v3 se")).toBe("/printers/ender-3%20v3%20se/community-firmware");
  });
});

describe("/research (MF-916, docs/design/research.workbench.md §1)", () => {
  it("/research без scope → очередь без сегмента", () => {
    expect(parseLocation("/research", "")).toEqual({ screen: "research", scope: undefined });
  });

  it("/research?scope=gaps → сегмент из известного набора", () => {
    expect(parseLocation("/research", "?scope=gaps")).toEqual({ screen: "research", scope: "gaps" });
  });

  it("/research?scope=bogus → неизвестный сегмент игнорируется", () => {
    expect(parseLocation("/research", "?scope=bogus")).toEqual({ screen: "research", scope: undefined });
  });

  it("/research/new → форма создания, ДО общего /research/:slug", () => {
    expect(parseLocation("/research/new", "")).toEqual({ screen: "research-form", draft: undefined });
  });

  it("/research/new?draft=… → предзаполнение из строки поиска (§1.3)", () => {
    expect(parseLocation("/research/new", "?draft=K1%20Max")).toEqual({ screen: "research-form", draft: "K1 Max" });
  });

  it("/research/:slug → форма карточки (slug декодируется)", () => {
    expect(parseLocation("/research/creality.k1-max", "")).toEqual({ screen: "research-form", slug: "creality.k1-max" });
  });

  it("researchPath/researchFormPath/researchNewPath строят канонические ссылки", () => {
    expect(researchPath()).toBe("/research");
    expect(researchPath("low_confidence")).toBe("/research?scope=low_confidence");
    expect(researchFormPath("creality.k1-max")).toBe("/research/creality.k1-max");
    expect(researchNewPath()).toBe("/research/new");
    expect(researchNewPath("K1 Max")).toBe("/research/new?draft=K1%20Max");
  });
});

describe("headerModeFor (четыре режима общей web-шапки)", () => {
  it("home → presentation (единственный случай)", () => {
    expect(headerModeFor("home")).toBe("presentation");
  });

  it("все остальные маршруты — full (дефолт, без исключений по типу)", () => {
    expect(headerModeFor("market")).toBe("full");
    expect(headerModeFor("feed")).toBe("full");
    expect(headerModeFor("printers")).toBe("full");
    expect(headerModeFor("research")).toBe("full");
    expect(headerModeFor("research-form")).toBe("full");
    expect(headerModeFor("communities")).toBe("full");
    expect(headerModeFor("model")).toBe("full");
    expect(headerModeFor("profile")).toBe("full");
    expect(headerModeFor("feed-post")).toBe("full");
    expect(headerModeFor("generate")).toBe("full");
    expect(headerModeFor("community")).toBe("full");
    expect(headerModeFor("thread")).toBe("full");
  });

  it("viewerFullscreen=true → back, независимо от screen", () => {
    expect(headerModeFor("model", { viewerFullscreen: true })).toBe("back");
    expect(headerModeFor("home", { viewerFullscreen: true })).toBe("back");
  });

  it("withBack=true → mixed для рабочих страниц", () => {
    expect(headerModeFor("feed-post", { withBack: true })).toBe("mixed");
    expect(headerModeFor("home", { withBack: true })).toBe("mixed");
  });

  it("viewerFullscreen перекрывает withBack", () => {
    expect(headerModeFor("model", { viewerFullscreen: true, withBack: true })).toBe("back");
  });
});

describe("generatePath", () => {
  it("без id → /generate", () => {
    expect(generatePath()).toBe("/generate");
  });

  it("с id → /generate?gen=:id (кодирует)", () => {
    expect(generatePath("abc 123")).toBe("/generate?gen=abc%20123");
  });
});

describe("modelPath / addModelPath (IA-разгрузка, MF-476)", () => {
  it("без вкладки → голый /project/:id", () => {
    expect(modelPath("42")).toBe("/project/42");
  });

  it("с вкладкой → /project/:id/:tab", () => {
    expect(modelPath("42", "makes")).toBe("/project/42/makes");
  });

  it("projectBuildPath → отдельный build-route с конфигурацией", () => {
    expect(projectBuildPath("robot 1", "pair")).toBe("/project/robot%201/build?config=pair");
  });

  it("projectStudioPath → авторская мастерская с источником", () => {
    expect(projectStudioPath("robot 1", { view: "release", source: "https://github.com/a/b" })).toBe(
      "/project/robot%201/studio?view=release&source=https%3A%2F%2Fgithub.com%2Fa%2Fb",
    );
  });

  it("id кодируется", () => {
    expect(modelPath("abc 123")).toBe("/project/abc%20123");
  });

  it("addModelPath → /project/add", () => {
    expect(addModelPath()).toBe("/project/add");
  });
});

describe("feedPath / feedPostPath / feedNewPath / communityPath (MF-816)", () => {
  it("feedPath → /feed", () => {
    expect(feedPath()).toBe("/feed");
  });

  it("feedPath кодирует slug конкретного саба", () => {
    expect(feedPath(undefined, "bambu lab фанаты")).toBe("/feed?community=bambu%20lab%20%D1%84%D0%B0%D0%BD%D0%B0%D1%82%D1%8B");
  });

  it("feedPostPath кодирует id", () => {
    expect(feedPostPath("abc 123")).toBe("/feed/p/abc%20123");
  });

  it("feedNewPath без модели → голый /feed/new", () => {
    expect(feedNewPath()).toBe("/feed/new");
  });

  it("feedNewPath с моделью → ?model=:id", () => {
    expect(feedNewPath("abc 123")).toBe("/feed/new?model=abc%20123");
  });

  it("communityPath кодирует slug", () => {
    expect(communityPath("bambu lab")).toBe("/community/bambu%20lab");
  });

  it("communitiesPath → /community", () => {
    expect(communitiesPath()).toBe("/community");
  });

  it("threadPath кодирует id", () => {
    expect(threadPath("abc 123")).toBe("/thread/abc%20123");
  });
});

describe("issueNewPath (контекст-пейлоад дверей входа, MF-694)", () => {
  it("без контекста → голый /issue/new", () => {
    expect(issueNewPath()).toBe("/issue/new");
  });

  it("только title/category → query из двух полей", () => {
    expect(issueNewPath({ title: "Держатель катушки", category: "catalog" })).toBe(
      "/issue/new?title=%D0%94%D0%B5%D1%80%D0%B6%D0%B0%D1%82%D0%B5%D0%BB%D1%8C+%D0%BA%D0%B0%D1%82%D1%83%D1%88%D0%BA%D0%B8&category=catalog",
    );
  });

  it("problem + ref → все поля контракта §3.1", () => {
    const path = issueNewPath({
      type: "problem",
      category: "catalog",
      ref: { type: "model", id: "abc 123", title: "Держатель v2" },
    });
    expect(path).toBe(
      "/issue/new?category=catalog&type=problem&ref_type=model&ref_id=abc+123&ref_title=%D0%94%D0%B5%D1%80%D0%B6%D0%B0%D1%82%D0%B5%D0%BB%D1%8C+v2",
    );
  });

  it("ref без title — не шлём ref_title", () => {
    expect(issueNewPath({ ref: { type: "broken_link", id: "42" } })).toBe("/issue/new?ref_type=broken_link&ref_id=42");
  });
});

describe("parseIssueNewContext (обратный разбор для формы подачи)", () => {
  it("пустой search → пустой контекст", () => {
    expect(parseIssueNewContext("")).toEqual({});
  });

  it("читает title/category/type/ref обратно", () => {
    expect(parseIssueNewContext("?title=Vase&category=catalog&type=problem&ref_type=model&ref_id=42&ref_title=Vase%20v2")).toEqual({
      title: "Vase",
      category: "catalog",
      type: "problem",
      ref: { type: "model", id: "42", title: "Vase v2" },
    });
  });

  it("невалидный type — игнорируем поле", () => {
    expect(parseIssueNewContext("?type=whatever")).toEqual({});
  });

  it("ref_type без ref_id — ref не собираем (неполный контекст)", () => {
    expect(parseIssueNewContext("?ref_type=model")).toEqual({});
  });

  it("issueNewPath → parseIssueNewContext даёт исходный контекст (round-trip)", () => {
    const context = { title: "Заголовок", category: "account", type: "idea" as const, ref: { type: "forum_thread", id: "9", title: "Ветка" } };
    const path = issueNewPath(context);
    const search = path.slice(path.indexOf("?"));
    expect(parseIssueNewContext(search)).toEqual(context);
  });
});

describe("legacyHashToPath (редирект старых #/market-ссылок)", () => {
  it("#/market → /project", () => {
    expect(legacyHashToPath("#/market")).toBe("/project");
  });

  it("#/market?tag=x → /project?tag=x (сохраняет query)", () => {
    expect(legacyHashToPath("#/market?tag=vase")).toBe("/project?tag=vase");
  });

  it("#/market/model/:id → /project/:id", () => {
    expect(legacyHashToPath("#/market/model/42")).toBe("/project/42");
  });

  it("#/u/:username → /u/:username", () => {
    expect(legacyHashToPath("#/u/plag")).toBe("/u/plag");
  });

  it("#/kitchen-sink → /kitchen-sink", () => {
    expect(legacyHashToPath("#/kitchen-sink")).toBe("/kitchen-sink");
  });

  it("#/ → корень", () => {
    expect(legacyHashToPath("#/")).toBe("/");
  });

  it("не-роутовый hash → null (не трогаем)", () => {
    expect(legacyHashToPath("")).toBeNull();
    expect(legacyHashToPath("#section")).toBeNull();
  });
});

describe("useRoute + popstate (MF-607 дизайн-ревью: возврат браузерной кнопкой/`history.back()` шёл мимо View Transition, капсула шапки телепортировалась)", () => {
  afterEach(() => {
    delete (document as unknown as { startViewTransition?: unknown }).startViewTransition;
    delete document.documentElement.dataset.navDir;
    delete document.documentElement.dataset.navFallback;
    window.history.pushState(null, "", "/");
  });

  it("popstate оборачивает смену роута в document.startViewTransition с direction=back", () => {
    const startViewTransition = vi.fn((callback: () => void) => {
      callback();
      return {} as ViewTransition;
    });
    (document as unknown as { startViewTransition: typeof startViewTransition }).startViewTransition = startViewTransition;

    window.history.pushState(null, "", "/feed/p/42");
    const { result } = renderHook(() => useRoute());
    expect(result.current).toEqual({ screen: "feed-post", id: "42" });

    // Браузер уже сдвинул pathname ДО popstate (тот же порядок событий, что при history.back()) —
    // именно на этот случай не хватало обёртки (feed/post.tsx handleBack() зовёт history.back()
    // напрямую, минуя navigate()).
    window.history.pushState(null, "", "/feed");
    act(() => {
      window.dispatchEvent(new PopStateEvent("popstate"));
    });

    expect(startViewTransition).toHaveBeenCalledTimes(1);
    expect(document.documentElement.dataset.navDir).toBe("back");
    expect(result.current).toEqual({ screen: "feed" });
  });

  it("без document.startViewTransition (старый браузер) роут всё равно обновляется", () => {
    window.history.pushState(null, "", "/feed/p/42");
    const { result } = renderHook(() => useRoute());

    window.history.pushState(null, "", "/feed");
    act(() => {
      window.dispatchEvent(new PopStateEvent("popstate"));
    });

    expect(result.current).toEqual({ screen: "feed" });
    expect(document.documentElement.dataset.navFallback).toBe("back");
  });
});
