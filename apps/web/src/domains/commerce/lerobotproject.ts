// Максимально заполненный showcase многокомпонентного проекта.
//
// LeRobotDepot — открытый community-каталог совместимого железа, печатных деталей
// и роботов для LeRobot. Для интерактивного 3D и сборочного сценария showcase
// использует открытые артефакты SO-101, на который ссылается сам каталог.
// Все URL закреплены на commit SHA: LeRobotDepot — MIT, SO-ARM100 — Apache-2.0.

import type { ProjectBuildGuide } from "./buildguide.ts";
import type { ModelDetail, RepoHistoryResult, RepoTreeResult } from "./models.types.ts";
import { soarmFollowerBuildGuide } from "./projectmanifest.editor.ts";

export const LEROBOT_PROJECT_ID = "lerobotdepot";
export const SOARM_PROJECT_ID = "so-arm100";

export function isLeRobotProjectId(id: string): boolean {
  return id === LEROBOT_PROJECT_ID || id === SOARM_PROJECT_ID;
}

const DEPOT_COMMIT = "5cd256e02e311b6537c5f8bd2c45aee0a65e3e9c";
const SO101_COMMIT = "fda892cba81032c46c40976a48c9ceadbf40a9ca";
const DEPOT_REPO_URL = "https://github.com/maximilienroberti/lerobotdepot";
const SO101_REPO_URL = "https://github.com/TheRobotStudio/SO-ARM100";
const DEPOT_RAW = `https://raw.githubusercontent.com/maximilienroberti/lerobotdepot/${DEPOT_COMMIT}`;
const SO101_RAW = `https://raw.githubusercontent.com/TheRobotStudio/SO-ARM100/${SO101_COMMIT}`;

export const LEROBOT_PROJECT_MEDIA = {
  depot: `${DEPOT_RAW}/media/lerobotdepot_logo.png`,
  arm: `${DEPOT_RAW}/media/so-arm100.jpg`,
  lekiwi: `${DEPOT_RAW}/media/LeKiwi.png`,
  xlerobot: `${DEPOT_RAW}/media/xlerobot.png`,
  bimanual: `${DEPOT_RAW}/media/ab-so-bot.png`,
  gripper: `${DEPOT_RAW}/media/compliant_gripper_2.png`,
  camera: `${DEPOT_RAW}/media/cambot.png`,
};

export const LEROBOT_PROJECT_DOWNLOADS: Record<string, string> = {
  canonical_3mf: `${SO101_RAW}/STL/SO101/Individual/SO101%20Assembly.stl`,
  source: `${SO101_RAW}/STL/SO101/Follower/Ender_Follower_SO101.stl`,
  drawing: `${SO101_RAW}/STEP/SO101/SO101%20Assembly.step`,
  code_archive: "https://github.com/huggingface/lerobot/archive/refs/heads/main.zip",
};

export function lerobotModelFor(id: string): ModelDetail | null {
  if (!isLeRobotProjectId(id)) return null;
  const isSourceProject = id === SOARM_PROJECT_ID;
  const description = isSourceProject
    ? [
        "SO‑ARM100 — открытый проект роботизированной руки, из которого выросла конфигурация **SO‑101** для LeRobot. На Portal исходники превращаются в понятный выпуск: что печатать, что купить, как собрать, прошить и проверить.",
        "",
        "### Что здесь можно собрать",
        "",
        "- одну follower‑руку SO‑101 для записи движений и экспериментов;",
        "- пару leader/follower для teleoperation и сбора датасетов;",
        "- печатный комплект с проверкой посадки сервоприводов до полной сборки;",
        "- электронику, калибровку и запуск LeRobot как один воспроизводимый сценарий.",
        "",
        "Вкладка проекта закрепляет файлы, BOM, совместимость и инструкцию на конкретной версии. Доработки можно вести веткой в Git или визуально в Author Studio, а потребитель всегда начинает со стабильного релиза.",
        "",
        `[Исходный репозиторий](${SO101_REPO_URL}) · [Файлы SO‑101](${SO101_REPO_URL}/tree/${SO101_COMMIT}/STL/SO101) · [Лицензия Apache‑2.0](${SO101_REPO_URL}/blob/${SO101_COMMIT}/LICENSE)`,
      ].join("\n")
    : [
        "LeRobotDepot собирает в одном месте открытые роботизированные руки, мобильные платформы, захваты, камеры и детали, совместимые с библиотекой **LeRobot**.",
        "",
        "### Что здесь можно собрать",
        "",
        "- напечатать детали руки SO‑101 и проверить посадки калибровочными шаблонами;",
        "- купить сервоприводы, контроллеры, крепёж, камеры и питание по BOM;",
        "- собрать одну руку, связку leader/follower или мобильного робота;",
        "- установить LeRobot, откалибровать приводы и записывать датасеты для обучения;",
        "- выбрать совместимые расширения и поделиться своим вариантом с сообществом.",
        "",
        "Эта страница показывает, каким на 3mf.tech становится **проект-система**: файлы, покупки, инструменты, код, инструкция, результаты людей и история репозитория живут вместе.",
        "",
        `[Открыть LeRobotDepot](${DEPOT_REPO_URL}) · [SO‑101 и файлы для печати](${SO101_REPO_URL}) · [Лицензия MIT](${DEPOT_REPO_URL}/blob/${DEPOT_COMMIT}/LICENSE)`,
      ].join("\n");

  return {
    id,
    title: isSourceProject ? "SO‑ARM100 / SO‑101 — открытая роботизированная рука" : "LeRobotDepot — открытая робототехника",
    description,
    status: "ready",
    source_format: "stl",
    craft: "3d_printing",
    manufacturing_method: "fdm",
    requires_ams: false,
    created_at: "2025-01-10T12:00:00.000Z",
    votes_up: 225,
    votes_down: 4,
    downloads_count: 18_740,
    comments_count: 42,
    views_count: 68_320,
    price_minor: 0,
    currency: "RUB",
    tags: ["LeRobot", "SO-101", "робототехника", "AI", "Python", "FDM", "сборка", "open-source"],
    thumb_url: isSourceProject ? `${SO101_RAW}/media/SO101_Follower.webp` : LEROBOT_PROJECT_MEDIA.xlerobot,
    owner: {
      id: isSourceProject ? "the-robot-studio" : "lerobotdepot-community",
      username: isSourceProject ? "TheRobotStudio" : "maximilienroberti",
      display_name: isSourceProject ? "The Robot Studio" : "LeRobotDepot community",
      avatar_url: null,
      avatar_config: null,
      avatar_snapshots: null,
      trusted_uploader: true,
    },
    project_summary: { file_count: 28, build_steps_count: 8 },
    purchased: true,
    publish_status: "published",
    bbox: { size: [320, 210, 640], unit: "mm" },
    size_bytes: 86_420_000,
    my_vote: 0,
    make_stats: {
      makes_count: 184,
      machines_count: 27,
      materials_count: 31,
      avg_printability_rating: 4.6,
      avg_geometry_quality_rating: 4.8,
      avg_surface_quality_rating: 4.5,
    },
    top_combos: [
      {
        machine: { id: "lerobot-machine-a1", model: "Bambu Lab A1" },
        material: { id: "lerobot-pla-plus", name: "PLA+" },
        combo_count: 46,
      },
      {
        machine: { id: "lerobot-machine-ender", model: "Creality Ender-3" },
        material: { id: "lerobot-pla", name: "PLA" },
        combo_count: 31,
      },
      {
        machine: { id: "lerobot-machine-mk4", model: "Original Prusa MK4" },
        material: { id: "lerobot-petg", name: "PETG" },
        combo_count: 18,
      },
    ],
    // Полная сборка весит десятки мегабайт и перегружает первый экран. Для интерактивного
    // предпросмотра берём реальную печатную деталь из того же закреплённого релиза SO-101,
    // а полный комплект по-прежнему отдаём через download_url.
    preview_url: `${SO101_RAW}/STL/SO101/Individual/Upper_arm_SO101.stl`,
    preview_mobile_url: null,
    download_url: LEROBOT_PROJECT_DOWNLOADS.canonical_3mf!,
    repo_url: isSourceProject ? SO101_REPO_URL : DEPOT_REPO_URL,
    recommended_material: {
      id: "lerobot-pla-plus",
      slug: "pla-plus",
      name: "PLA+, 1.75 мм",
      vendor: { id: "demo-generic", slug: "generic", name: "" },
    },
    files: [
      {
        id: "lerobot-so101-assembly",
        role: "source",
        format: "stl",
        size_bytes: 18_940_000,
        original_filename: "SO101 Assembly.stl",
      },
      {
        id: "lerobot-follower-plate",
        role: "source",
        format: "stl",
        size_bytes: 12_830_000,
        original_filename: "Ender_Follower_SO101.stl",
      },
      {
        id: "lerobot-leader-plate",
        role: "source",
        format: "stl",
        size_bytes: 12_410_000,
        original_filename: "Ender_Leader_SO101.stl",
      },
      {
        id: "lerobot-cad",
        role: "drawing",
        format: "step",
        size_bytes: 24_700_000,
        original_filename: "SO101 Assembly.step",
      },
      {
        id: "lerobot-code",
        role: "code_archive",
        format: "zip",
        size_bytes: 17_500_000,
        original_filename: "lerobot-main.zip",
      },
    ],
  };
}

export function lerobotTreeFor(id: string): RepoTreeResult | null {
  if (!isLeRobotProjectId(id)) return null;
  if (id === SOARM_PROJECT_ID) {
    return {
      source: "git",
      entries: [
        { path: "README.md", size_bytes: 36_921 },
        { path: "STL/SO101/Follower/Ender_Follower_SO101.stl", size_bytes: 12_830_000 },
        { path: "STL/SO101/Leader/Ender_Leader_SO101.stl", size_bytes: 12_410_000 },
        { path: "STL/SO101/Individual/Upper_arm_SO101.stl", size_bytes: 2_140_000 },
        { path: "STEP/SO101/SO101 Assembly.step", size_bytes: 24_700_000 },
        { path: "Simulation/SO101/SO101.urdf", size_bytes: 19_870 },
        { path: "media/SO101_Follower.webp", size_bytes: 356_000 },
        { path: "media/SO101_Leader.webp", size_bytes: 348_000 },
        { path: "LICENSE", size_bytes: 11_371 },
      ],
    };
  }
  return {
    source: "git",
    entries: [
      { path: "README.md", size_bytes: 54_321 },
      { path: "catalog/feetech/SO-101.md", size_bytes: 16_482 },
      { path: "catalog/mobile/LeKiwi.md", size_bytes: 12_906 },
      { path: "catalog/mobile/XLeRobot.md", size_bytes: 21_410 },
      { path: "print/SO101/SO101 Assembly.stl", size_bytes: 18_940_000 },
      { path: "print/SO101/Ender_Follower_SO101.stl", size_bytes: 12_830_000 },
      { path: "print/SO101/Ender_Leader_SO101.stl", size_bytes: 12_410_000 },
      { path: "cad/SO101 Assembly.step", size_bytes: 24_700_000 },
      { path: "bom/SO101-two-arms.csv", size_bytes: 8_420 },
      { path: "software/lerobot/configs/robot/so101.yaml", size_bytes: 3_840 },
      { path: "software/examples/teleoperate.py", size_bytes: 7_932 },
      { path: "docs/assembly-and-calibration.md", size_bytes: 18_240 },
      { path: "LICENSE", size_bytes: 1_071 },
    ],
  };
}

export function lerobotHistoryFor(id: string): RepoHistoryResult | null {
  if (!isLeRobotProjectId(id)) return null;
  if (id === SOARM_PROJECT_ID) {
    return {
      source: "git",
      commits: [
        {
          sha: SO101_COMMIT.slice(0, 12),
          author_name: "The Robot Studio",
          author_email: "opensource@therobotstudio.com",
          authored_at: "2026-02-26T12:00:00.000Z",
          subject: "Update README.md",
        },
        {
          sha: "aec17b1",
          author_name: "The Robot Studio",
          author_email: "opensource@therobotstudio.com",
          authored_at: "2026-01-12T12:00:00.000Z",
          subject: "Update actuator model params",
        },
        {
          sha: "9a6f6d7",
          author_name: "The Robot Studio",
          author_email: "opensource@therobotstudio.com",
          authored_at: "2025-12-02T12:00:00.000Z",
          subject: "Add compliant soft finray gripper",
        },
        {
          sha: "787c510",
          author_name: "The Robot Studio",
          author_email: "opensource@therobotstudio.com",
          authored_at: "2025-11-18T12:00:00.000Z",
          subject: "Update Seeed Studio mounting plate",
        },
      ],
    };
  }
  return {
    source: "git",
    commits: [
      {
        sha: DEPOT_COMMIT.slice(0, 12),
        author_name: "Maximilien Roberti",
        author_email: "community@lerobotdepot.dev",
        authored_at: "2026-07-17T10:18:00.000Z",
        subject: "Merge community hardware updates",
      },
      {
        sha: "8f128c839b81",
        author_name: "LeRobotDepot community",
        author_email: "community@lerobotdepot.dev",
        authored_at: "2026-06-29T14:42:00.000Z",
        subject: "Add cameras and teleoperation hardware",
      },
      {
        sha: "2485dc69512a",
        author_name: "LeRobotDepot community",
        author_email: "community@lerobotdepot.dev",
        authored_at: "2026-05-18T09:14:00.000Z",
        subject: "Document SO-101 and XLeRobot kits",
      },
      {
        sha: "1a92b670cf47",
        author_name: "Maximilien Roberti",
        author_email: "community@lerobotdepot.dev",
        authored_at: "2025-01-10T12:00:00.000Z",
        subject: "Initial open hardware catalog",
      },
    ],
  };
}

export function lerobotBuildGuideFor(id: string): ProjectBuildGuide | null {
  if (!isLeRobotProjectId(id)) return null;
  if (id === SOARM_PROJECT_ID) return soarmFollowerBuildGuide();
  return {
    id: "lerobotdepot-so101-guide",
    version: 3,
    steps: [
      {
        id: "lerobot-choose",
        position: 1,
        title: "Выбрать конфигурацию",
        body: "Начните с одной follower-руки SO‑101 или пары leader/follower. Мобильные LeKiwi и XLeRobot лучше собирать после проверки рук на столе.",
        mesh_id: null,
        mesh_object_ref: null,
        parts: [
          { name: "SO‑101 follower", quantity: "1 рука", kind: "assembly" },
          { name: "SO‑101 leader", quantity: "опционально", kind: "assembly" },
        ],
        tools: [{ name: "LeRobotDepot", quantity: "матрица совместимости" }],
        photos: [
          {
            id: "lerobot-choose-photo",
            url: LEROBOT_PROJECT_MEDIA.arm,
            position: 1,
            size_bytes: 486_000,
            mime_type: "image/jpeg",
          },
        ],
      },
      {
        id: "lerobot-print",
        position: 2,
        title: "Напечатать детали SO‑101",
        body: "Перед полным комплектом распечатайте gauge под сервопривод. Основной профиль: PLA+, сопло 0,4 мм, слой 0,2 мм, заполнение 15%, поддержки только там, где они действительно нужны.",
        mesh_id: "so101-assembly-preview",
        mesh_object_ref: { path: "print/SO101/SO101 Assembly.stl" },
        parts: [
          { name: "Follower plate", quantity: "1 комплект", kind: "print" },
          { name: "Leader plate", quantity: "опционально", kind: "print" },
          { name: "Калибровочный gauge", quantity: "1 шт.", kind: "print" },
          { name: "PLA+", quantity: "≈ 1 кг на пару", kind: "buy" },
        ],
        tools: [{ name: "FDM-принтер", quantity: "стол от 220 × 220 мм" }],
        photos: [
          {
            id: "lerobot-print-photo",
            url: `${SO101_RAW}/media/SO101_Follower.webp`,
            position: 1,
            size_bytes: 356_000,
            mime_type: "image/webp",
          },
        ],
      },
      {
        id: "lerobot-bom",
        position: 3,
        title: "Собрать комплект электроники",
        body: "Сверяйте передаточные числа сервоприводов: follower и leader используют разные наборы. Для одной follower-руки достаточно шести STS3215, контроллера, питания и USB.",
        mesh_id: null,
        mesh_object_ref: null,
        parts: [
          { name: "Feetech STS3215 7.4V", quantity: "6 шт.", kind: "buy" },
          { name: "Motor Control Board", quantity: "1 шт.", kind: "buy" },
          { name: "Блок питания 5V", quantity: "1 шт.", kind: "buy" },
          { name: "USB‑C кабель", quantity: "1 шт.", kind: "buy" },
          { name: "Крепёж M3", quantity: "комплект", kind: "buy" },
          { name: "Струбцины", quantity: "2 шт.", kind: "buy" },
        ],
        tools: [{ name: "Крестовые отвёртки", quantity: "#0 и #1" }, { name: "Шестигранники" }],
        photos: [
          {
            id: "lerobot-bom-photo",
            url: LEROBOT_PROJECT_MEDIA.arm,
            position: 1,
            size_bytes: 486_000,
            mime_type: "image/jpeg",
          },
        ],
      },
      {
        id: "lerobot-assemble",
        position: 4,
        title: "Собрать руку",
        body: "Сначала соберите основание и плечо, затем локоть, запястье и захват. Не пережимайте корпус сервоприводов и оставьте кабелям свободную петлю на каждом суставе.",
        mesh_id: null,
        mesh_object_ref: null,
        parts: [
          { name: "Печатные детали SO‑101", quantity: "комплект", kind: "print" },
          { name: "Сервоприводы и крепёж", quantity: "по BOM", kind: "buy" },
        ],
        tools: [{ name: "Отвёртка" }, { name: "Бокорезы" }, { name: "Маркировка кабелей" }],
        photos: [
          {
            id: "lerobot-assembly-photo",
            url: LEROBOT_PROJECT_MEDIA.bimanual,
            position: 1,
            size_bytes: 512_000,
            mime_type: "image/png",
          },
        ],
      },
      {
        id: "lerobot-camera",
        position: 5,
        title: "Добавить зрение и захват",
        body: "Выберите wrist-камеру и совместимое крепление, после чего проверьте, что захват виден в кадре. Гибкие пальцы можно напечатать из TPU 95A.",
        mesh_id: null,
        mesh_object_ref: null,
        parts: [
          { name: "UVC-камера 32 × 32 мм", quantity: "1 шт.", kind: "buy" },
          { name: "Крепление камеры", quantity: "1 шт.", kind: "print" },
          { name: "Compliant gripper", quantity: "опционально", kind: "print" },
        ],
        tools: [{ name: "TPU 95A", quantity: "для гибких пальцев" }],
        photos: [
          {
            id: "lerobot-camera-photo",
            url: LEROBOT_PROJECT_MEDIA.gripper,
            position: 1,
            size_bytes: 412_000,
            mime_type: "image/png",
          },
        ],
      },
      {
        id: "lerobot-code",
        position: 6,
        title: "Установить LeRobot",
        body: "Создайте Python-окружение, установите LeRobot и выберите конфигурацию SO‑101. Подключите контроллер по USB и проверьте, что все ID сервоприводов обнаружены.",
        mesh_id: null,
        mesh_object_ref: null,
        parts: [{ name: "LeRobot", quantity: "Python-пакет", kind: "code" }],
        tools: [{ name: "Python 3.10+" }, { name: "Компьютер с Linux/macOS" }, { name: "USB" }],
        photos: [
          {
            id: "lerobot-code-photo",
            url: LEROBOT_PROJECT_MEDIA.depot,
            position: 1,
            size_bytes: 118_000,
            mime_type: "image/png",
          },
        ],
      },
      {
        id: "lerobot-calibrate",
        position: 7,
        title: "Калибровать и проверить",
        body: "Запустите калибровку, вручную пройдите доступный диапазон каждого сустава и сохраните профиль. Затем проверьте teleoperation на малой скорости без нагрузки.",
        mesh_id: null,
        mesh_object_ref: null,
        parts: [],
        tools: [{ name: "LeRobot CLI" }, { name: "Свободная рабочая зона" }],
        photos: [
          {
            id: "lerobot-calibrate-photo",
            url: LEROBOT_PROJECT_MEDIA.camera,
            position: 1,
            size_bytes: 338_000,
            mime_type: "image/png",
          },
        ],
      },
      {
        id: "lerobot-mobile",
        position: 8,
        title: "Расширить до мобильного робота",
        body: "Когда рука стабильно работает, добавьте базу LeKiwi или соберите XLeRobot с двумя руками, батареей и несколькими камерами. Это отдельный проверяемый этап, а не обязательная часть первого запуска.",
        mesh_id: null,
        mesh_object_ref: null,
        parts: [
          { name: "LeKiwi base", quantity: "1 комплект", kind: "assembly" },
          { name: "SO‑101", quantity: "1–2 руки", kind: "assembly" },
          { name: "Батарея", quantity: "1 шт.", kind: "buy" },
          { name: "Камеры", quantity: "2–3 шт.", kind: "buy" },
        ],
        tools: [{ name: "Документация XLeRobot" }],
        photos: [
          {
            id: "lerobot-mobile-photo",
            url: LEROBOT_PROJECT_MEDIA.xlerobot,
            position: 1,
            size_bytes: 644_000,
            mime_type: "image/png",
          },
        ],
      },
    ],
  };
}
