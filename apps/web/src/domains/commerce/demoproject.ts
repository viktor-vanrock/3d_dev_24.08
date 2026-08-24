// Заполненный showcase проекта для визуальной и продуктовой проверки страницы.
// Это не мок «лампы из одного STL»: Otto DIY объединяет печатные детали, BOM,
// электронику, код и сборку. Исходные материалы принадлежат Otto DIY и доступны
// по CC BY-SA 4.0; ссылки закреплены на конкретном commit, чтобы демо не протухало.

import type { ProjectBuildGuide } from "./buildguide.ts";
import {
  LEROBOT_PROJECT_DOWNLOADS,
  LEROBOT_PROJECT_ID,
  SOARM_PROJECT_ID,
  lerobotBuildGuideFor,
  lerobotHistoryFor,
  lerobotModelFor,
  lerobotTreeFor,
} from "./lerobotproject.ts";
import type { ModelDetail, RepoHistoryResult, RepoTreeResult } from "./models.types.ts";

export const DEMO_PROJECT_ID = "otto-diy";

const SOURCE_COMMIT = "873cd0c47d58f0555500af766243c66e691e4ca8";
const REPO_URL = "https://github.com/Blue-Design/OttoDIY";
const RAW_ROOT = `https://raw.githubusercontent.com/Blue-Design/OttoDIY/${SOURCE_COMMIT}`;
const CDN_ROOT = `https://cdn.jsdelivr.net/gh/Blue-Design/OttoDIY@${SOURCE_COMMIT}`;
const SOURCE_ROOT = `${RAW_ROOT}/OTTO_V02_BOM_STP_STL`;
const CDN_SOURCE_ROOT = `${CDN_ROOT}/OTTO_V02_BOM_STP_STL`;

export const DEMO_PROJECT_MEDIA = {
  main: `${RAW_ROOT}/OTTO_main.jpg`,
  head: `${SOURCE_ROOT}/Otto_Head%2BFaceEars.png`,
  flyer: `${RAW_ROOT}/OTTO_flyer.jpg`,
  electronics: `${RAW_ROOT}/OTTO_Product%20Requirement%20Specifications.jpg`,
};

export const DEMO_PROJECT_DOWNLOADS: Record<string, string> = {
  canonical_3mf: `${SOURCE_ROOT}/Otto_Head%2BFace_Ears.stl`,
  source: `${SOURCE_ROOT}/OTTO_body_v3.stl`,
  drawing: `${SOURCE_ROOT}/OTTO_v03.stp`,
  code_archive: `${RAW_ROOT}/OTTO_DIY_all.zip`,
};

export function isDemoProjectId(id: string): boolean {
  return id === DEMO_PROJECT_ID || id === LEROBOT_PROJECT_ID || id === SOARM_PROJECT_ID;
}

export function demoProjectDownloadsFor(id: string): Record<string, string> {
  return id === LEROBOT_PROJECT_ID || id === SOARM_PROJECT_ID ? LEROBOT_PROJECT_DOWNLOADS : DEMO_PROJECT_DOWNLOADS;
}

export function demoModelFor(id: string): ModelDetail | null {
  const lerobot = lerobotModelFor(id);
  if (lerobot) return lerobot;
  if (id !== DEMO_PROJECT_ID) return null;
  return {
    id: DEMO_PROJECT_ID,
    title: "Otto DIY — соберите своего робота",
    description: [
      "Otto — открытый Arduino-совместимый робот, которого можно напечатать, собрать из доступной электроники и оживить собственным кодом.",
      "",
      "### Что получится",
      "",
      "- шагающий робот высотой около 12 см;",
      "- корпус из семи печатных деталей;",
      "- ультразвуковое зрение, звук и четыре сервопривода;",
      "- прошивка Arduino с движениями, танцами и обходом препятствий.",
      "",
      "Это демонстрационный проект страницы 3mf.tech. Исходные материалы — **Otto DIY**: файлы, BOM и инструкция доступны в открытом репозитории.",
      "",
      `[Открыть исходный проект](${REPO_URL}) · [Лицензия CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/)`,
    ].join("\n"),
    status: "ready",
    source_format: "stl",
    craft: "3d_printing",
    manufacturing_method: "fdm",
    requires_ams: false,
    created_at: "2016-01-03T10:00:00.000Z",
    votes_up: 284,
    votes_down: 7,
    downloads_count: 4138,
    price_minor: 0,
    currency: "RUB",
    tags: ["робототехника", "Arduino", "сборка", "электроника", "FDM", "open-source"],
    thumb_url: null,
    owner: {
      id: "otto-diy-open-source",
      username: "ottodiy",
      display_name: "Otto DIY",
      avatar_url: null,
      avatar_config: null,
      avatar_snapshots: null,
      trusted_uploader: true,
    },
    project_summary: { file_count: 12, build_steps_count: 6 },
    purchased: true,
    publish_status: "published",
    bbox: { size: [70, 110, 120], unit: "mm" },
    size_bytes: 32_660_103,
    my_vote: 0,
    make_stats: {
      makes_count: 126,
      machines_count: 18,
      materials_count: 24,
      avg_printability_rating: 4.7,
      avg_geometry_quality_rating: 4.8,
      avg_surface_quality_rating: 4.6,
    },
    top_combos: [
      {
        machine: { id: "demo-machine-1", model: "Bambu Lab A1" },
        material: { id: "demo-material-1", name: "PLA Basic" },
        combo_count: 28,
      },
      {
        machine: { id: "demo-machine-2", model: "Creality Ender-3" },
        material: { id: "demo-material-2", name: "PLA" },
        combo_count: 19,
      },
    ],
    preview_url: `${CDN_SOURCE_ROOT}/Otto_Head%2BFace_Ears.stl`,
    preview_mobile_url: null,
    download_url: DEMO_PROJECT_DOWNLOADS.canonical_3mf!,
    repo_url: REPO_URL,
    recommended_material: {
      id: "demo-pla",
      slug: "pla",
      name: "PLA, 1.75 мм",
      vendor: { id: "demo-generic", slug: "generic", name: "" },
    },
    files: [
      { id: "demo-body", role: "source", format: "stl", size_bytes: 357_384, original_filename: "OTTO_body_v3.stl" },
      { id: "demo-head", role: "source", format: "stl", size_bytes: 244_084, original_filename: "OTTO_head_v3.stl" },
      { id: "demo-leg", role: "source", format: "stl", size_bytes: 283_684, original_filename: "OTTO_leg_v4.stl" },
      { id: "demo-foot-l", role: "source", format: "stl", size_bytes: 233_484, original_filename: "OTTO_footL_v3.stl" },
      { id: "demo-foot-r", role: "source", format: "stl", size_bytes: 233_484, original_filename: "OTTO_footR_v3.stl" },
      { id: "demo-step", role: "drawing", format: "stp", size_bytes: 17_495_727, original_filename: "OTTO_v03.stp" },
      { id: "demo-code", role: "code_archive", format: "zip", size_bytes: 10_493_484, original_filename: "OTTO_DIY_all.zip" },
    ],
  };
}

export function demoTreeFor(id: string): RepoTreeResult | null {
  const lerobot = lerobotTreeFor(id);
  if (lerobot) return lerobot;
  if (id !== DEMO_PROJECT_ID) return null;
  return {
    source: "git",
    entries: [
      { path: "README.md", size_bytes: 3_189 },
      { path: "print/OTTO_body_v3.stl", size_bytes: 357_384 },
      { path: "print/OTTO_head_v3.stl", size_bytes: 244_084 },
      { path: "print/OTTO_leg_v4.stl", size_bytes: 283_684 },
      { path: "print/OTTO_footL_v3.stl", size_bytes: 233_484 },
      { path: "print/OTTO_footR_v3.stl", size_bytes: 233_484 },
      { path: "cad/OTTO_v03.stp", size_bytes: 17_495_727 },
      { path: "code/OTTO_avoid/OTTO_avoid.ino", size_bytes: 4_312 },
      { path: "code/OTTO_smooth_criminal/OTTO_smooth_criminal.ino", size_bytes: 7_962 },
      { path: "docs/OTTO_BOM.xlsx", size_bytes: 9_842 },
      { path: "docs/OTTO_InstructionsManual_V04_arduino.pdf", size_bytes: 594_944 },
    ],
  };
}

export function demoHistoryFor(id: string): RepoHistoryResult | null {
  const lerobot = lerobotHistoryFor(id);
  if (lerobot) return lerobot;
  if (id !== DEMO_PROJECT_ID) return null;
  return {
    source: "git",
    commits: [
      {
        sha: "873cd0c47d58",
        author_name: "Otto DIY",
        author_email: "opensource@ottodiy.com",
        authored_at: "2020-08-20T11:12:00.000Z",
        subject: "docs: update README",
      },
      {
        sha: "7f9ab8e1d4ad",
        author_name: "Otto DIY",
        author_email: "opensource@ottodiy.com",
        authored_at: "2017-02-14T09:30:00.000Z",
        subject: "feat: add code/OTTO_avoid/OTTO_avoid.ino",
      },
      {
        sha: "43ca18e8b902",
        author_name: "Otto DIY",
        author_email: "opensource@ottodiy.com",
        authored_at: "2016-01-03T10:00:00.000Z",
        subject: "feat: add print/OTTO_body_v3.stl",
      },
    ],
  };
}

export function demoBuildGuideFor(id: string): ProjectBuildGuide | null {
  const lerobot = lerobotBuildGuideFor(id);
  if (lerobot) return lerobot;
  if (id !== DEMO_PROJECT_ID) return null;
  return {
    id: "otto-diy-guide",
    version: 4,
    steps: [
      {
        id: "otto-print",
        position: 1,
        title: "Распечатать корпус",
        body: "Напечатайте корпус, голову, две ноги и левую/правую стопу из PLA. Базовый профиль: слой 0,20 мм, заполнение 20%, без поддержек.",
        mesh_id: "otto-head-preview",
        mesh_object_ref: { path: "print/OTTO_head_v3.stl" },
        parts: [
          { name: "Корпус", quantity: "1 шт.", kind: "print" },
          { name: "Голова", quantity: "1 шт.", kind: "print" },
          { name: "Ноги", quantity: "2 шт.", kind: "print" },
          { name: "Стопы", quantity: "левая + правая", kind: "print" },
        ],
        tools: [{ name: "FDM-принтер", quantity: "стол от 120 × 120 мм" }],
        photos: [
          {
            id: "otto-print-photo",
            url: `${SOURCE_ROOT}/Otto_Head%2BFaceEars.png`,
            position: 1,
            size_bytes: 308_893,
            mime_type: "image/png",
          },
        ],
      },
      {
        id: "otto-buy",
        position: 2,
        title: "Собрать электронный комплект",
        body: "Сверьтесь с BOM до начала сборки: вся механика рассчитана на распространённые модули без пайки.",
        mesh_id: null,
        mesh_object_ref: null,
        parts: [
          { name: "Arduino Nano ATmega328", quantity: "1 шт.", kind: "buy" },
          { name: "Nano I/O Shield", quantity: "1 шт.", kind: "buy" },
          { name: "Микросерво SG90", quantity: "4 шт.", kind: "buy" },
          { name: "HC-SR04", quantity: "1 шт.", kind: "buy" },
          { name: "Buzzer 5V", quantity: "1 шт.", kind: "buy" },
          { name: "Провода Dupont F–F", quantity: "6 шт.", kind: "buy" },
        ],
        tools: [{ name: "Малая крестовая отвёртка" }],
        photos: [
          {
            id: "otto-bom-photo",
            url: `${RAW_ROOT}/OTTO_Product%20Requirement%20Specifications.jpg`,
            position: 1,
            size_bytes: 1_625_424,
            mime_type: "image/jpeg",
          },
        ],
      },
      {
        id: "otto-mechanics",
        position: 3,
        title: "Собрать механику",
        body: "Установите сервоприводы в ноги и стопы, выставив каждый вал в центральное положение. Затем закрепите ноги в корпусе.",
        mesh_id: null,
        mesh_object_ref: null,
        parts: [
          { name: "Саморезы из комплекта SG90", quantity: "8 шт.", kind: "buy" },
          { name: "Печатные детали корпуса", quantity: "комплект", kind: "print" },
        ],
        tools: [{ name: "Крестовая отвёртка" }],
        photos: [
          {
            id: "otto-mechanics-photo",
            url: `${RAW_ROOT}/OTTO_main.jpg`,
            position: 1,
            size_bytes: 406_492,
            mime_type: "image/jpeg",
          },
        ],
      },
      {
        id: "otto-wire",
        position: 4,
        title: "Подключить датчики и питание",
        body: "Подключите четыре сервопривода, ультразвуковой датчик, зуммер и батарейный отсек к Nano Shield по схеме. Перед включением ещё раз проверьте полярность.",
        mesh_id: null,
        mesh_object_ref: null,
        parts: [
          { name: "Держатель 4 × AA", quantity: "1 шт.", kind: "buy" },
          { name: "Батарейки AA", quantity: "4 шт.", kind: "buy" },
          { name: "Тумблер", quantity: "1 шт.", kind: "buy" },
        ],
        tools: [{ name: "Мультиметр", quantity: "рекомендуется" }],
        photos: [],
      },
      {
        id: "otto-code",
        position: 5,
        title: "Загрузить прошивку",
        body: "Установите Arduino IDE, добавьте библиотеки Otto и откройте `OTTO_avoid.ino`. Выберите Arduino Nano / ATmega328 и загрузите скетч по USB.",
        mesh_id: null,
        mesh_object_ref: null,
        parts: [{ name: "USB-A → Mini-USB", quantity: "1 шт.", kind: "buy" }],
        tools: [{ name: "Arduino IDE" }, { name: "Компьютер с USB" }],
        photos: [
          {
            id: "otto-code-photo",
            url: `${RAW_ROOT}/OTTO_flyer.jpg`,
            position: 1,
            size_bytes: 1_049_554,
            mime_type: "image/jpeg",
          },
        ],
      },
      {
        id: "otto-test",
        position: 6,
        title: "Калибровать и оживить",
        body: "Поставьте робота на ровную поверхность, откалибруйте нейтральные положения сервоприводов и проверьте шаг, повороты, звук и обход препятствий.",
        mesh_id: null,
        mesh_object_ref: null,
        parts: [],
        tools: [{ name: "Линейка" }, { name: "Свободная площадка 1 × 1 м" }],
        photos: [],
      },
    ],
  };
}
