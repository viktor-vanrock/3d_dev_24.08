import type {
  GetProjectManifestResult,
  PutProjectManifestRequest,
  PutProjectManifestResult,
  ResolvedProjectGraph,
} from "@portal/contracts/http/models";
import type {
  ProjectBuildArtifact,
  ProjectBuildGuide,
  ProjectBuildPhase,
  ProjectBuildStep,
} from "./buildguide.ts";
import {
  PROJECT_CODE_CONTRACT_VERSION,
  PROJECT_MANIFEST_SCHEMA_URL,
} from "./projectmanifest.constants.ts";

const DEMO_STORAGE_KEY = "project-studio:so-arm100:manifest";

export const SOARM_BASE_HEAD = "fda892cba81032c46c40976a48c9ceadbf40a9ca";
export const SOARM_REPO_URL = "https://github.com/TheRobotStudio/SO-ARM100";
export const SOARM_RAW_URL = `https://raw.githubusercontent.com/TheRobotStudio/SO-ARM100/${SOARM_BASE_HEAD}`;
export const LEROBOT_SO101_GUIDE_URL = "https://huggingface.co/docs/lerobot/so101";

export const SOARM_MANIFEST: ResolvedProjectGraph = {
  schema: PROJECT_MANIFEST_SCHEMA_URL,
  project: {
    uid: "so-arm100",
    title: "SO‑ARM100 / SO‑101",
    "default-configuration": "so101-follower",
    units: { length: "mm", coordinates: "right-handed-z-up" },
    license: { spdx: "Apache-2.0", file: "LICENSE" },
    authors: [{ name: "The Robot Studio", url: "https://github.com/TheRobotStudio" }],
    upstream: {
      url: "https://github.com/TheRobotStudio/SO-ARM100",
      ref: "main",
      commit: SOARM_BASE_HEAD,
    },
    release: { version: "0.1.14-portal.1", notes: "Первый выпуск с интерактивной сборкой SO‑101." },
  },
  artifacts: {
    "gauge-loose": { kind: "print-model", path: "STL/Gauges/Gauge_0.STL", role: "calibration" },
    "gauge-tight": { kind: "print-model", path: "STL/Gauges/Gauge_tight_1.STL", role: "calibration" },
    "follower-plate": { kind: "print-model", path: "STL/SO101/Follower/Ender_Follower_SO101.stl", role: "print" },
    "follower-plate-prusa": { kind: "print-model", path: "STL/SO101/Follower/Prusa_Follower_SO101.stl", role: "print" },
    "base": { kind: "print-model", path: "STL/SO101/Individual/Base_SO101.stl", role: "print" },
    "base-motor-holder": { kind: "print-model", path: "STL/SO101/Individual/Base_motor_holder_SO101.stl", role: "print" },
    "shoulder-holder": { kind: "print-model", path: "STL/SO101/Individual/Motor_holder_SO101_Base.stl", role: "print" },
    "wrist-holder": { kind: "print-model", path: "STL/SO101/Individual/Motor_holder_SO101_Wrist.stl", role: "print" },
    "under-arm": { kind: "print-model", path: "STL/SO101/Individual/Under_arm_SO101.stl", role: "print" },
    "upper-arm": { kind: "print-model", path: "STL/SO101/Individual/Upper_arm_SO101.stl", role: "print" },
    "rotation-pitch": { kind: "print-model", path: "STL/SO101/Individual/Rotation_Pitch_SO101.stl", role: "print" },
    "wrist-roll-pitch": { kind: "print-model", path: "STL/SO101/Individual/Wrist_Roll_Pitch_SO101.stl", role: "print" },
    "moving-jaw": { kind: "print-model", path: "STL/SO101/Individual/Moving_Jaw_SO101.stl", role: "print" },
    "wrist-roll-follower": { kind: "print-model", path: "STL/SO101/Individual/Wrist_Roll_Follower_SO101.stl", role: "print" },
    "leader-plate": { kind: "print-model", path: "STL/SO101/Leader/Ender_Leader_SO101.stl", role: "print" },
    "assembly-cad": { kind: "cad", path: "STEP/SO101/SO101 Assembly.step", role: "source" },
    "simulation-urdf": { kind: "simulation", path: "Simulation/SO101/so101.urdf", role: "software" },
  },
  components: {
    "printed-follower": { kind: "manufactured", artifact: "follower-plate" },
    "servo-sts3215": { kind: "purchased", "catalog-ref": "servo.feetech.sts3215" },
    "motor-control-board": { kind: "purchased", "catalog-ref": "board.feetech.usb" },
    "pla-plus": { kind: "consumable", "catalog-ref": "material.pla-plus.175" },
    "python-runtime": { kind: "software", artifact: "simulation-urdf" },
    "hex-driver": { kind: "tool", "catalog-ref": "tool.hex-driver" },
  },
  configurations: {
    "so101-follower": {
      title: "Одна follower-рука SO‑101",
      artifacts: [
        "gauge-loose",
        "gauge-tight",
        "follower-plate",
        "follower-plate-prusa",
        "base",
        "base-motor-holder",
        "shoulder-holder",
        "wrist-holder",
        "under-arm",
        "upper-arm",
        "rotation-pitch",
        "wrist-roll-pitch",
        "moving-jaw",
        "wrist-roll-follower",
        "assembly-cad",
        "simulation-urdf",
      ],
      components: ["printed-follower", "servo-sts3215", "motor-control-board", "pla-plus", "python-runtime", "hex-driver"],
      workflow: "so101-build",
      requirements: {
        machines: ["FDM · стол от 220 × 220 мм", "Snapmaker U1 · совместим по столу 270 × 270 мм (пилотный профиль)"],
        materials: ["PLA+ · 0,4 мм · слой 0,2 мм · заполнение 15%"],
        skills: ["Сборка без пайки", "Python 3.10+"],
      },
      bom: [
        { component: "printed-follower", quantity: 1, unit: "комплект", source: "printed" },
        { component: "servo-sts3215", quantity: 6, unit: "шт.", source: "purchased" },
        { component: "motor-control-board", quantity: 1, unit: "шт.", source: "purchased" },
        { component: "pla-plus", quantity: 0.6, unit: "кг", source: "purchased" },
      ],
    },
    "so101-pair": {
      title: "Пара leader + follower",
      artifacts: ["follower-plate", "leader-plate", "assembly-cad", "simulation-urdf"],
      components: ["printed-follower", "servo-sts3215", "motor-control-board", "pla-plus", "python-runtime", "hex-driver"],
      workflow: "so101-build",
      requirements: {
        machines: ["FDM · стол от 220 × 220 мм"],
        materials: ["PLA+ · около 1,2 кг"],
        skills: ["Сборка", "Калибровка", "Python 3.10+"],
      },
      bom: [
        { component: "printed-follower", quantity: 2, unit: "комплекта", source: "printed" },
        { component: "servo-sts3215", quantity: 12, unit: "шт.", source: "purchased" },
        { component: "motor-control-board", quantity: 2, unit: "шт.", source: "purchased" },
        { component: "pla-plus", quantity: 1.2, unit: "кг", source: "purchased" },
      ],
    },
  },
  workflows: {
    "so101-build": {
      phases: {
        print: { type: "print", steps: ["check-kit", "print-gauges", "print-parts", "clean-parts"] },
        flash: { type: "flash", "depends-on": ["print"], steps: ["install-lerobot", "configure-servos"] },
        assembly: {
          type: "assembly",
          "depends-on": ["flash"],
          steps: ["assemble-base-arm", "assemble-wrist-gripper", "wire-controller"],
        },
        check: { type: "check", "depends-on": ["assembly"], steps: ["calibrate", "first-motion"] },
      },
      steps: {
        "check-kit": {
          title: "Проверить комплект и рабочее место",
          instruction: "Сверьте follower-комплект: 6 STS3215 7,4 В, контроллер, питание, USB‑C, крепёж и отвёртки #0/#1.",
          evidence: { accepted: ["confirmation"] },
        },
        "print-gauges": {
          title: "Напечатать два калибровочных шаблона",
          instruction: "До большого задания распечатайте обычный и тугой gauge. Они проверят усадку материала и посадку STS3215.",
          action: { type: "send-to-printer", artifact: "gauge-loose", preset: "pla-plus-0.2" },
          evidence: { accepted: ["confirmation", "photo"] },
        },
        "print-parts": {
          title: "Напечатать follower-комплект SO‑101",
          instruction: "Выберите готовую плиту 220 × 220 мм или отдельные STL. Базовый профиль автора: PLA+, сопло 0,4 мм, слой 0,2 мм, заполнение 15%.",
          action: { type: "send-to-printer", artifact: "follower-plate", preset: "pla-plus-0.2" },
          evidence: { accepted: ["machine_result", "photo"] },
        },
        "clean-parts": {
          title: "Снять поддержки и разложить детали",
          instruction: "Удалите поддержки, не повредив горизонтальные отверстия. Разложите основание, плечо, предплечье, запястье и захват до установки приводов.",
          evidence: { accepted: ["photo", "confirmation"] },
        },
        "install-lerobot": {
          title: "Установить LeRobot и драйвер Feetech",
          instruction: "Создайте окружение LeRobot, установите extras Feetech и найдите последовательный порт контроллера.",
          action: { type: "open-software-guide", artifact: "simulation-urdf" },
          evidence: { accepted: ["confirmation"] },
        },
        "configure-servos": {
          title: "Назначить ID 1–6 до сборки",
          instruction: "Подключайте только один привод за раз и запускайте lerobot-setup-motors. Команда записывает ID и baud rate в EEPROM; обычная сборка не требует отдельной пользовательской прошивки.",
          evidence: { accepted: ["confirmation"] },
        },
        "assemble-base-arm": {
          title: "Собрать основание, плечо и локоть",
          instruction: "Установите моторы 1–3 по порядку: основание, плечо, затем локоть. Используйте M2×6 для корпусов приводов и M3×6 для рогов и звеньев.",
          evidence: { accepted: ["photo"] },
        },
        "assemble-wrist-gripper": {
          title: "Собрать запястье и захват",
          instruction: "Установите моторы 4–6, оставляя свободную петлю кабеля на каждом суставе. Затем закрепите wrist roll и подвижную губку.",
          evidence: { accepted: ["photo"] },
        },
        "wire-controller": {
          title: "Соединить шину и контроллер",
          instruction: "Соберите daisy-chain от плеча ID 1 к захвату ID 6, подключите контроллер, питание и USB‑C. Не подавайте питание до проверки полярности.",
          warnings: ["Проверьте полярность питания перед включением."],
          evidence: { accepted: ["confirmation", "photo"] },
        },
        calibrate: {
          title: "Откалибровать суставы",
          instruction: "Поставьте руку в среднее положение, запустите lerobot-calibrate и вручную проведите каждый сустав через полный безопасный диапазон.",
          evidence: { accepted: ["machine_result"] },
        },
        "first-motion": {
          title: "Проверить первое движение",
          instruction: "Запустите движение малой амплитуды без нагрузки. Убедитесь, что ID обнаружены, кабели не натягиваются, а профиль калибровки сохранился.",
          evidence: { accepted: ["photo", "measurement"] },
        },
      },
    },
  },
  "x-portal-build": {
    version: 5,
    sourceCommit: SOARM_BASE_HEAD,
    sourceDocs: LEROBOT_SO101_GUIDE_URL,
    stepArtifacts: {
      "print-gauges": ["gauge-loose", "gauge-tight"],
      "print-parts": ["follower-plate", "follower-plate-prusa", "upper-arm", "under-arm", "base", "moving-jaw"],
      "clean-parts": ["upper-arm", "under-arm", "base", "moving-jaw"],
      "assemble-base-arm": ["base", "upper-arm", "under-arm"],
      "assemble-wrist-gripper": ["wrist-roll-follower", "moving-jaw"],
    },
  },
  "x-portal-authoring": {
    sourceMode: "git",
    workingBranch: "portal/dev",
    releaseBranch: "main",
    detectedAt: "2026-07-19T13:55:00.000Z",
  },
};

const SOARM_STEP_PHASES: Record<string, ProjectBuildPhase> = {
  "check-kit": "check",
  "print-gauges": "print",
  "print-parts": "print",
  "clean-parts": "check",
  "install-lerobot": "flash",
  "configure-servos": "flash",
  "assemble-base-arm": "assembly",
  "assemble-wrist-gripper": "assembly",
  "wire-controller": "assembly",
  calibrate: "check",
  "first-motion": "check",
};

const SOARM_ARTIFACT_LABELS: Record<string, Pick<ProjectBuildArtifact, "label" | "role" | "quantity" | "note">> = {
  "gauge-loose": {
    label: "Gauge 0 · обычная посадка",
    role: "calibration",
    quantity: "1 шт.",
    note: "Первый короткий тест усадки перед большой печатью.",
  },
  "gauge-tight": {
    label: "Gauge tight · плотная посадка",
    role: "calibration",
    quantity: "1 шт.",
    note: "Сравните два шаблона на одном материале и профиле.",
  },
  "follower-plate": {
    label: "Follower plate · стол 220 × 220 мм",
    role: "print",
    quantity: "1 комплект",
    note: "Основная подготовленная плита SO‑101.",
  },
  "follower-plate-prusa": {
    label: "Follower plate · стол 205 × 250 мм",
    role: "print",
    quantity: "альтернатива",
    note: "Узкая раскладка для совместимых столов.",
  },
  base: { label: "Основание", role: "print", quantity: "1 шт." },
  "upper-arm": { label: "Верхнее звено", role: "print", quantity: "1 шт." },
  "under-arm": { label: "Нижнее звено", role: "print", quantity: "1 шт." },
  "moving-jaw": { label: "Подвижная губка", role: "print", quantity: "1 шт." },
  "wrist-roll-follower": { label: "Wrist roll follower", role: "print", quantity: "1 шт." },
};

const SOARM_STEP_META: Record<
  string,
  Pick<ProjectBuildStep, "parts" | "tools" | "commands" | "checklist" | "warnings" | "source">
> = {
  "check-kit": {
    parts: [
      { name: "Feetech STS3215 7,4 В · 1/345", quantity: "6 шт." },
      { name: "Motor Control Board", quantity: "1 шт." },
      { name: "USB‑C и блок питания", quantity: "по 1 шт." },
      { name: "Струбцины", quantity: "2 шт." },
    ],
    tools: [{ name: "Крестовые отвёртки", quantity: "#0 и #1" }],
    checklist: [
      "Передаточное число всех шести follower-сервоприводов совпадает со спецификацией.",
      "На столе достаточно места для безопасного движения руки.",
      "Питание пока отключено.",
    ],
    source: { label: "SO‑ARM100 · Bill of materials", url: `${SOARM_REPO_URL}/blob/${SOARM_BASE_HEAD}/README.md`, locator: "Bill of materials" },
  },
  "print-gauges": {
    parts: [{ name: "PLA+", quantity: "немного, тот же моток, что для деталей" }],
    tools: [{ name: "FDM-принтер", quantity: "сопло 0,4 мм" }],
    checklist: [
      "Оба gauge напечатаны одним профилем.",
      "Сервопривод входит без трещин и чрезмерного люфта.",
      "Выбранная посадка записана перед большой печатью.",
    ],
    source: { label: "SO‑ARM100 · 3D printing", url: `${SOARM_REPO_URL}/blob/${SOARM_BASE_HEAD}/README.md`, locator: "First print the motor calibration gauges" },
  },
  "print-parts": {
    parts: [{ name: "PLA+", quantity: "≈ 0,6 кг на follower-комплект" }],
    tools: [{ name: "Snapmaker U1", quantity: "стол 270 × 270 мм · пилотный профиль" }],
    checklist: [
      "Сопло 0,4 мм, слой 0,2 мм и заполнение 15%.",
      "Поддержки не попадают в горизонтальные отверстия под крепёж.",
      "Предпросмотр слайсинга проверен до отправки.",
    ],
    warnings: ["Подключение и профиль Snapmaker U1 ещё проходят живую верификацию в MF‑1973/MF‑1974."],
    source: { label: "SO‑ARM100 · prepared print plates", url: `${SOARM_REPO_URL}/tree/${SOARM_BASE_HEAD}/STL/SO101/Follower`, locator: "220×220 and 205×250 plates" },
  },
  "clean-parts": {
    parts: [
      { name: "Основание, плечо, предплечье", quantity: "по 1" },
      { name: "Запястье и захват", quantity: "комплект" },
    ],
    tools: [{ name: "Бокорезы и дебуринг", quantity: "по необходимости" }],
    checklist: [
      "Поддержки сняты, но посадочные поверхности не сточены.",
      "Отверстия под M2/M3 свободны.",
      "Все детали разложены в порядке сборки.",
    ],
    source: { label: "SO‑ARM100 · clean supports", url: `${SOARM_REPO_URL}/blob/${SOARM_BASE_HEAD}/README.md`, locator: "Clean the supports of the printed parts" },
  },
  "install-lerobot": {
    parts: [{ name: "LeRobot", quantity: "репозиторий и Python-пакет" }],
    tools: [{ name: "Python", quantity: "совместимая версия из документации LeRobot" }],
    commands: [
      { label: "Установить поддержку Feetech", code: 'pip install -e ".[feetech]"' },
      { label: "Найти порт контроллера", code: "lerobot-find-port", note: "Отключите и снова подключите USB, когда попросит CLI." },
    ],
    checklist: ["Команда lerobot-find-port показывает стабильный порт контроллера."],
    source: { label: "LeRobot · SO‑101 setup", url: LEROBOT_SO101_GUIDE_URL, locator: "Install LeRobot / Find the port" },
  },
  "configure-servos": {
    parts: [{ name: "STS3215", quantity: "6 шт., подключать по одному" }],
    tools: [{ name: "Motor Control Board", quantity: "1 шт." }],
    commands: [
      {
        label: "Записать ID и baud rate",
        code: "lerobot-setup-motors \\\n  --robot.type=so101_follower \\\n  --robot.port=/dev/tty.usbmodemXXXX",
        note: "Замените порт на найденный предыдущим шагом.",
      },
    ],
    checklist: [
      "Каждый мотор настраивался отдельно.",
      "ID 1–6 подписаны до установки в печатные детали.",
      "Gripper имеет ID 6, shoulder pan — ID 1.",
    ],
    warnings: ["Не соединяйте все моторы до назначения уникальных ID.", "Это настройка EEPROM, а не загрузка произвольной прошивки."],
    source: { label: "LeRobot · configure motors", url: LEROBOT_SO101_GUIDE_URL, locator: "Configure the motors" },
  },
  "assemble-base-arm": {
    parts: [
      { name: "Моторы 1–3", quantity: "основание, плечо, локоть" },
      { name: "M2×6 и M3×6", quantity: "по схеме автора" },
    ],
    tools: [{ name: "Крестовая отвёртка", quantity: "#0/#1" }],
    checklist: [
      "Корпуса приводов закреплены M2×6 без перетяжки.",
      "Рога и звенья закреплены M3×6.",
      "Кабели имеют свободную петлю в суставах.",
    ],
    source: { label: "LeRobot · joints 1–3", url: LEROBOT_SO101_GUIDE_URL, locator: "Assemble the follower arm" },
  },
  "assemble-wrist-gripper": {
    parts: [
      { name: "Моторы 4–6", quantity: "запястье и захват" },
      { name: "Wrist roll и moving jaw", quantity: "по 1" },
    ],
    tools: [{ name: "Крестовая отвёртка", quantity: "#0/#1" }],
    checklist: [
      "Мотор 6 установлен в захват.",
      "Подвижная губка движется без закусывания.",
      "Кабели не зажаты печатными деталями.",
    ],
    source: { label: "LeRobot · joints 4–6", url: LEROBOT_SO101_GUIDE_URL, locator: "Wrist and gripper" },
  },
  "wire-controller": {
    parts: [{ name: "Сервошина, контроллер, питание, USB‑C", quantity: "1 комплект" }],
    tools: [{ name: "Маркировка кабелей", quantity: "рекомендуется" }],
    checklist: [
      "Daisy-chain идёт от ID 1 у основания к ID 6 в захвате.",
      "Полярность питания проверена до включения.",
      "Кабели не натягиваются в крайних положениях.",
    ],
    warnings: ["Отключите питание перед перестановкой разъёмов."],
    source: { label: "LeRobot · wiring", url: LEROBOT_SO101_GUIDE_URL, locator: "Connect the motors" },
  },
  calibrate: {
    parts: [],
    tools: [{ name: "Свободная рабочая зона", quantity: "полный диапазон руки" }],
    commands: [
      {
        label: "Калибровать follower",
        code: "lerobot-calibrate \\\n  --robot.type=so101_follower \\\n  --robot.port=/dev/tty.usbmodemXXXX \\\n  --robot.id=my_follower_arm",
      },
    ],
    checklist: [
      "Перед стартом рука установлена примерно в среднее положение.",
      "Каждый сустав вручную прошёл полный безопасный диапазон.",
      "Профиль сохранён под постоянным robot.id.",
    ],
    source: { label: "LeRobot · calibrate", url: LEROBOT_SO101_GUIDE_URL, locator: "Calibrate" },
  },
  "first-motion": {
    parts: [],
    tools: [{ name: "Аварийно доступное питание", quantity: "можно быстро отключить" }],
    checklist: [
      "Все шесть ID обнаружены.",
      "Движение начинается на малой амплитуде без нагрузки.",
      "Кабели и крепёж остаются свободными.",
      "Финальный результат сфотографирован для Make.",
    ],
    source: { label: "LeRobot · first use", url: LEROBOT_SO101_GUIDE_URL, locator: "Teleoperate" },
  },
};

function buildArtifact(artifactId: string): ProjectBuildArtifact | null {
  const artifact = SOARM_MANIFEST.artifacts?.[artifactId];
  const presentation = SOARM_ARTIFACT_LABELS[artifactId];
  if (!artifact?.path || !presentation) return null;
  return {
    id: artifactId,
    ...presentation,
    path: artifact.path,
    url: encodeURI(`${SOARM_RAW_URL}/${artifact.path}`),
    format: artifact.kind === "print-model" ? "stl" : "source",
  };
}

/**
 * Demo-adapter mirrors what `GET /models/:id/build-guide` will return after MF-1967:
 * the route renders the same code-first manifest, not a second hand-written instruction.
 */
export function soarmFollowerBuildGuide(): ProjectBuildGuide {
  const workflow = SOARM_MANIFEST.workflows?.["so101-build"];
  const artifactMap = (SOARM_MANIFEST["x-portal-build"] as { stepArtifacts?: Record<string, string[]> } | undefined)
    ?.stepArtifacts;
  const orderedStepIds = ["check-kit", "print-gauges", "print-parts", "clean-parts", "install-lerobot", "configure-servos", "assemble-base-arm", "assemble-wrist-gripper", "wire-controller", "calibrate", "first-motion"];
  const steps = orderedStepIds.flatMap<ProjectBuildStep>((stepId, index) => {
    const manifestStep = workflow?.steps[stepId];
    const meta = SOARM_STEP_META[stepId];
    if (!manifestStep || !meta) return [];
    return [{
      id: stepId,
      position: index + 1,
      title: manifestStep.title,
      body: manifestStep.instruction ?? null,
      phase: SOARM_STEP_PHASES[stepId] ?? "assembly",
      mesh_id: null,
      mesh_object_ref: null,
      parts: meta.parts,
      tools: meta.tools,
      photos: [],
      artifacts: (artifactMap?.[stepId] ?? []).flatMap((artifactId) => {
        const artifact = buildArtifact(artifactId);
        return artifact ? [artifact] : [];
      }),
      commands: meta.commands,
      checklist: meta.checklist,
      warnings: meta.warnings ?? manifestStep.warnings,
      source: meta.source,
    }];
  });
  return { id: "so-arm100-so101-follower", version: 5, steps };
}

function stableDigest(value: unknown): string {
  const raw = JSON.stringify(value);
  let hash = 2166136261;
  for (let index = 0; index < raw.length; index += 1) {
    hash ^= raw.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `demo-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

export function mergeManifestPreservingExtensions<T>(original: T, patch: Partial<T>): T {
  if (Array.isArray(original) || original === null || typeof original !== "object") return patch as T;
  const output: Record<string, unknown> = { ...(original as Record<string, unknown>) };
  for (const [key, value] of Object.entries(patch as Record<string, unknown>)) {
    const before = output[key];
    output[key] =
      before && value && typeof before === "object" && typeof value === "object" && !Array.isArray(before) && !Array.isArray(value)
        ? mergeManifestPreservingExtensions(before, value)
        : value;
  }
  return output as T;
}

function demoResult(manifest: ResolvedProjectGraph, headSha: string): GetProjectManifestResult {
  return {
    contract_version: PROJECT_CODE_CONTRACT_VERSION,
    head_sha: headSha,
    manifest_digest: stableDigest(manifest),
    configuration_digest: stableDigest(manifest.configurations?.[manifest.project["default-configuration"]] ?? null),
    manifest,
    diagnostics: [],
  };
}

export function readDemoManifest(): GetProjectManifestResult {
  try {
    const stored = window.localStorage.getItem(DEMO_STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored) as { manifest: ResolvedProjectGraph; headSha: string };
      return demoResult(parsed.manifest, parsed.headSha);
    }
  } catch {
    // Повреждённый localStorage не блокирует авторскую мастерскую.
  }
  return demoResult(structuredClone(SOARM_MANIFEST), SOARM_BASE_HEAD);
}

export class ProjectHeadConflictError extends Error {
  constructor(public readonly currentHeadSha: string) {
    super("project_head_conflict");
  }
}

export function saveDemoManifest(request: PutProjectManifestRequest): PutProjectManifestResult {
  const current = readDemoManifest();
  if (request.base_head_sha !== current.head_sha) throw new ProjectHeadConflictError(current.head_sha);
  const headSha = stableDigest({ previous: current.head_sha, request, savedAt: Date.now() }).replace("demo-", "portal");
  window.localStorage.setItem(DEMO_STORAGE_KEY, JSON.stringify({ manifest: request.manifest, headSha }));
  return {
    contract_version: PROJECT_CODE_CONTRACT_VERSION,
    head_sha: headSha,
    manifest_digest: stableDigest(request.manifest),
    configuration_digest: stableDigest(
      request.manifest.configurations?.[request.manifest.project["default-configuration"]] ?? null,
    ),
    diagnostics: [],
  };
}

export function resetDemoManifest(): void {
  window.localStorage.removeItem(DEMO_STORAGE_KEY);
}
