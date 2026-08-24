import { LEROBOT_PROJECT_MEDIA, isLeRobotProjectId } from "./lerobotproject.ts";
import type { ModelDetail } from "./models.ts";

export interface ProjectConfiguration {
  id: string;
  title: string;
  label: string;
  summary: string;
  imageUrl: string | null;
  recommended?: boolean;
  estimatedSteps: number;
  result: string;
  requirements: Array<{ label: string; value: string }>;
}

const LEROBOT_CONFIGURATIONS: ProjectConfiguration[] = [
  {
    id: "so101-follower",
    title: "Одна рука SO‑101",
    label: "Первый запуск",
    summary: "Самый короткий путь: напечатать follower-руку, подключить шесть сервоприводов и проверить управление.",
    imageUrl: LEROBOT_PROJECT_MEDIA.arm,
    recommended: true,
    estimatedSteps: 8,
    result: "Рабочая follower-рука для записи движений и экспериментов с LeRobot.",
    requirements: [
      { label: "Принтер", value: "FDM · стол от 220 × 220 мм" },
      { label: "Пластик", value: "PLA+ · около 600 г" },
      { label: "Электроника", value: "6 × STS3215 + контроллер" },
      { label: "Навыки", value: "Сборка без пайки · Python" },
    ],
  },
  {
    id: "so101-pair",
    title: "Leader + follower",
    label: "Телеприсутствие",
    summary: "Пара рук для ручного управления: одна считывает движение, вторая повторяет его и пишет датасет.",
    imageUrl: LEROBOT_PROJECT_MEDIA.bimanual,
    estimatedSteps: 10,
    result: "Комплект для teleoperation и сбора обучающих данных.",
    requirements: [
      { label: "Принтер", value: "FDM · стол от 220 × 220 мм" },
      { label: "Пластик", value: "PLA+ · около 1,2 кг" },
      { label: "Электроника", value: "12 × STS3215 + 2 контроллера" },
      { label: "Навыки", value: "Сборка · калибровка · Python" },
    ],
  },
  {
    id: "xlerobot",
    title: "Мобильный XLeRobot",
    label: "Полная система",
    summary: "Две руки, мобильная база, камеры, питание и компьютер — многокомпонентный робот для сложных сценариев.",
    imageUrl: LEROBOT_PROJECT_MEDIA.xlerobot,
    estimatedSteps: 14,
    result: "Мобильная двухрукая платформа с компьютерным зрением.",
    requirements: [
      { label: "Принтер", value: "FDM · стол от 220 × 220 мм" },
      { label: "Пластик", value: "PLA+/PETG · около 2 кг" },
      { label: "Комплект", value: "2 руки · база · 3 камеры · батарея" },
      { label: "Навыки", value: "Сборка · проводка · Linux · Python" },
    ],
  },
];

export function projectConfigurationsFor(model: ModelDetail): ProjectConfiguration[] {
  if (isLeRobotProjectId(model.id)) return LEROBOT_CONFIGURATIONS;
  return [
    {
      id: "default",
      title: model.title,
      label: "Базовая конфигурация",
      summary: "Основной вариант автора с файлами, материалами и последовательностью изготовления.",
      imageUrl: model.thumb_url,
      recommended: true,
      estimatedSteps: model.project_summary?.build_steps_count ?? 3,
      result: "Готовый результат по инструкции автора.",
      requirements: [
        { label: "Метод", value: model.manufacturing_method?.toUpperCase() ?? "По инструкции" },
        { label: "Материал", value: model.recommended_material?.name ?? "Указан в проекте" },
        { label: "Формат", value: model.source_format.toUpperCase() },
      ],
    },
  ];
}

export function projectConfigurationFor(model: ModelDetail, id?: string): ProjectConfiguration {
  const configurations = projectConfigurationsFor(model);
  return configurations.find((configuration) => configuration.id === id) ?? configurations.find((configuration) => configuration.recommended) ?? configurations[0]!;
}
