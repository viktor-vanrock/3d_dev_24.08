// Клиентское зеркало apps/api/src/models/formats.ts (docs/epics/formats.policy.md v0.2,
// docs/design/projects.multiformat.md §2.1): расширение → класс приёма. Используется ТОЛЬКО
// для предварительного UI-хинта (быстрый фидбэк до ответа сервера) и для accept-подсказки
// пикера — не защита. Финальная валидация (magic-байты, decompression-лимит) — на Back;
// UI на неё полагается и не хардкодит соответствие роли.

export type UploadClass = "pipeline" | "as_is";

// Ключи — нормализованные значения, которые сервер кладёт в source_format ответа
// (apps/api/src/models/formats.ts EXTENSION_TO_FORMAT): расширения-синонимы (stp/step, g/nc/tap/cnc,
// gtl/gbl/... и т.п.) сервер уже свёл к одному формату до того, как он попадёт в этот словарь.
const FORMAT_TO_CLASS: Record<string, UploadClass> = {
  stl: "pipeline",
  obj: "pipeline",
  "3mf": "pipeline",
  step: "as_is",
  dxf: "as_is",
  svg: "as_is",
  gcode: "as_is",
  gerber: "as_is",
  zip: "as_is",
};

// Расширения файлов (не нормализованные форматы) — для предварительного хинта по имени файла
// до аплоада и для accept-подсказки пикера (§2.1: список из formats.policy v0.2).
const EXTENSION_TO_CLASS: Record<string, UploadClass> = {
  stl: "pipeline",
  obj: "pipeline",
  "3mf": "pipeline",
  step: "as_is",
  stp: "as_is",
  dxf: "as_is",
  svg: "as_is",
  gcode: "as_is",
  g: "as_is",
  nc: "as_is",
  tap: "as_is",
  cnc: "as_is",
  gbr: "as_is",
  gtl: "as_is",
  gbl: "as_is",
  gto: "as_is",
  gbo: "as_is",
  gts: "as_is",
  gbs: "as_is",
  gko: "as_is",
  drl: "as_is",
  ger: "as_is",
  zip: "as_is",
};

// accept-подсказка пикера (§2.1) — краткий репрезентативный список, не исчерпывающий все
// синонимы-расширения из EXTENSION_TO_CLASS (ОС и так не защита, финал — magic-байты Back).
export const ACCEPT_EXTENSIONS = ".stl,.obj,.3mf,.step,.stp,.dxf,.svg,.gcode,.nc,.gbr,.zip";

// Подпись форматов (§1.2 таблица, строка 6) — кнопка «Добавить проект» и подсказка дропзоны:
// честный список обоих классов, не «любой формат».
export const FORMATS_HINT = "STL · 3MF · STEP · чертежи · G-code · код — до 100 МБ";

export function extensionOf(filename: string): string {
  const dot = filename.lastIndexOf(".");
  return dot === -1 ? "" : filename.slice(dot + 1).toLowerCase();
}

export function isAcceptedExtension(filename: string): boolean {
  return extensionOf(filename) in EXTENSION_TO_CLASS;
}

export function classForFilename(filename: string): UploadClass | null {
  return EXTENSION_TO_CLASS[extensionOf(filename)] ?? null;
}

export function classForFormat(format: string): UploadClass | null {
  return FORMAT_TO_CLASS[format] ?? null;
}

// Честная маркировка (§2.1/§2.2): чип класса + тост после аплоада.
export const CLASS_META: Record<UploadClass, { chip: string; uploadedToast: string; hint?: string }> = {
  pipeline: { chip: "Печать · сконвертируем в 3MF", uploadedToast: "Проект загружен" },
  as_is: {
    chip: "Артефакт · сохраним как есть",
    uploadedToast: "Файл сохранён",
    hint: "Файл будет доступен для скачивания как есть. Просмотра во вьюере и конвертации не будет.",
  },
};
