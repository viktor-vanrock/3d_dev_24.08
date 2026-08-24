import { useState } from "react";
import type { OverlayApi } from "@platform/overlay";
import { IconButton } from "@shared/ui";

// Слой 4+5 обучающего дерева (MF-435/MF-438 § «Послойный обучающий слой»): микро-уроки
// СТРОГО по запросу (≤5 шагов каждый, заготовки из карточки эпика) + пассивная точка входа
// «?» (слой 5, всегда на месте, ничего не триггерит сама). Живут в overlay.sheet — тот же
// «прогрессивное раскрытие» примитив, что уже используют picker/filament-шаги first-run.

export interface MicroLesson {
  id: string;
  title: string;
  steps: string[];
}

export const MICRO_LESSONS: MicroLesson[] = [
  {
    id: "start-printing",
    title: "Как начать печатать",
    steps: [
      "Привяжите принтер (аватар → «Принтеры» или карточка «Совместимо с вашим»).",
      "Откройте модель с бейджем «печатается на вашем {принтер}».",
      "Скачайте готовый 3MF/gcode-файл со страницы модели.",
      "Загрузите файл в слайсер или на карту принтера и запустите печать.",
    ],
  },
  {
    id: "filament-profile",
    title: "Что такое филамент и профиль печати",
    steps: [
      "Филамент — пластиковая нить (PLA, PETG и др.), из которой печатает принтер.",
      "У каждого материала свой профиль: температура сопла/стола, скорость.",
      "Укажите свой филамент в профиле — модели и советы будут точнее под него.",
      "Профиль не блокирует печать — это подсказка, не жёсткое ограничение.",
    ],
  },
  {
    id: "first-upload",
    title: "Загрузи первую модель",
    steps: [
      "Кнопка «Добавить модель» — доступна из чек-листа и раздела «Проекты».",
      "Загрузите исходник (STL/OBJ/3MF и другие поддерживаемые форматы).",
      "Заполните название и описание — это карточка, которую увидят другие.",
      "Опубликуйте — модель появится в каталоге и на вашей странице автора.",
    ],
  },
  {
    id: "printer-compat",
    title: "Совместим ли принтер с моделью",
    steps: [
      "Бейдж «печатается на вашем {принтер}» на карточке модели — она точно подойдёт.",
      "Без бейджа модель может потребовать больший стол или другое сопло.",
      "Совместимость сверяется автоматически по принтерам в вашем профиле.",
      "Уточняем алгоритм по мере роста каталога принтеров (MF-33) — бейдж будет точнее.",
    ],
  },
];

function HelpSheetContent({ initialLessonId }: { initialLessonId?: string }) {
  const [openId, setOpenId] = useState<string | null>(initialLessonId ?? null);
  const open = MICRO_LESSONS.find((lesson) => lesson.id === openId) ?? null;

  if (open) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <button type="button" className="homeSkipLink pressable" style={{ alignSelf: "flex-start", padding: 0 }} onClick={() => setOpenId(null)}>
          ← Все темы
        </button>
        <ol style={{ display: "flex", flexDirection: "column", gap: 10, margin: 0, paddingLeft: 20 }}>
          {open.steps.map((step, index) => (
            <li key={index} style={{ fontSize: 14, lineHeight: 1.5 }}>
              {step}
            </li>
          ))}
        </ol>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      {MICRO_LESSONS.map((lesson) => (
        <button
          key={lesson.id}
          type="button"
          className="homePopItem pressable"
          style={{ textAlign: "left" }}
          onClick={() => setOpenId(lesson.id)}
        >
          {lesson.title}
        </button>
      ))}
    </div>
  );
}

export function openHelpPanel(overlay: OverlayApi): void {
  overlay.sheet({ title: "Помощь", content: <HelpSheetContent /> });
}

// Точка входа из персона-CTA дома (personahome.tsx «Как это работает») — открывает конкретный
// урок сразу, минуя список тем, но остаётся тем же слоем 4 «по запросу», не отдельным экраном.
export function openMicroLesson(overlay: OverlayApi, lessonId: string): void {
  overlay.sheet({ title: "Помощь", content: <HelpSheetContent initialLessonId={lessonId} /> });
}

// Пассивная точка входа «?» (слой 5) — ничего не показывает сама, только по тапу.
export function HelpButton({ overlay }: { overlay: OverlayApi }) {
  return (
    <IconButton label="Помощь" onClick={() => openHelpPanel(overlay)}>
      <span aria-hidden="true" style={{ fontFamily: "var(--font-display)", fontSize: 15, fontWeight: 600 }}>
        ?
      </span>
    </IconButton>
  );
}
