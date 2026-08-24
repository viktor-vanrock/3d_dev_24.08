// Клиентское зеркало docs/research/printer.schema.json (MF-917, спека docs/design/research.workbench.md
// §2.5/§5): единый источник разметки формы — секции/лейблы/типы полей живут здесь, не размазаны
// по JSX компонентов секций. Порядок SPEC_SECTIONS СОВПАДАЕТ с apps/api/src/printers/contract.ts
// (тот же список секций схемы) — расхождение сломает field_sources-пути между фронтом и API.

export type FieldType = "text" | "number" | "boolean" | "select";

export interface FieldOption {
  value: string;
  label: string;
}

export interface FieldDef {
  key: string;
  label: string;
  type: FieldType;
  options?: FieldOption[];
  placeholder?: string;
}

export interface SectionDef {
  key: string;
  label: string;
  fields: FieldDef[];
}

// Идентичность (§2.3) — brand/model/slug/aliases/status/released_at обрабатываются своими
// виджетами в identitysection.tsx, не generic SchemaField-циклом. kinematics/type/enclosed —
// в printer.schema.json это тоже верхнеуровневые (не в SPEC_SECTIONS), спека §2.3 явно их не
// упоминает — кладём их сюда же (классификация принтера, та же природа, что status): решение
// Front по реализуемости, не переизобретение UX-потока (§7.2 «расхождение — сначала комментарий
// Design»), см. итоговый комментарий карточки MF-917.
export const KINEMATICS_OPTIONS: FieldOption[] = [
  { value: "cartesian", label: "Картезианская" },
  { value: "corexy", label: "CoreXY" },
  { value: "delta", label: "Дельта" },
  { value: "scara", label: "SCARA" },
  { value: "idex", label: "IDEX" },
  { value: "polar", label: "Полярная" },
  { value: "belt", label: "Лента (бесконечная Z)" },
];

export const PRINTER_TYPE_OPTIONS: FieldOption[] = [
  { value: "fdm", label: "FDM" },
  { value: "resin-lcd", label: "Смола — LCD" },
  { value: "resin-dlp", label: "Смола — DLP" },
  { value: "resin-sla", label: "Смола — SLA" },
];

export const STATUS_OPTIONS: FieldOption[] = [
  { value: "announced", label: "Анонсирован" },
  { value: "shipping", label: "Выпускается" },
  { value: "eol", label: "Снят с производства" },
  { value: "rumored", label: "Слухи" },
];

export const CONFIDENCE_OPTIONS: { value: "high" | "medium" | "low"; label: string }[] = [
  { value: "high", label: "Сверил с офсайтом" },
  { value: "medium", label: "Одна вторичная статья" },
  { value: "low", label: "Слухи, ревизия неясна" },
];

// Секции спек (§2.2: «Спеки (по секциям схемы)») — порядок и ключи 1:1 с SPEC_SECTIONS в contract.ts.
// Массивные секции (toolhead_extras/materials_supported/unique_features) рендерятся отдельными
// list-редакторами (specsection.tsx), не через generic FieldDef-цикл — здесь их поля не перечислены.
export const SPEC_SECTIONS: SectionDef[] = [
  {
    key: "build_volume",
    label: "Объём печати",
    fields: [
      { key: "x", label: "X, мм", type: "number" },
      { key: "y", label: "Y, мм", type: "number" },
      { key: "z", label: "Z, мм", type: "number" },
      { key: "shape", label: "Форма стола", type: "select", options: [{ value: "rect", label: "Прямоугольный" }, { value: "round", label: "Круглый" }] },
      { key: "diameter", label: "Диаметр (круглый/дельта), мм", type: "number" },
    ],
  },
  {
    key: "hotend",
    label: "Хотэнд",
    fields: [
      { key: "max_temp_c", label: "Макс. температура, °C", type: "number" },
      { key: "max_flow_mm3s", label: "Макс. поток, мм³/с", type: "number" },
      { key: "nozzle_default_mm", label: "Сопло по умолчанию, мм", type: "number" },
      { key: "nozzle_swappable", label: "Сопло сменное", type: "boolean" },
      { key: "material", label: "Материал (напр. hardened steel)", type: "text" },
      { key: "hardened", label: "Закалённый (под абразивы)", type: "boolean" },
    ],
  },
  {
    key: "bed",
    label: "Стол (нагрев)",
    fields: [
      { key: "max_temp_c", label: "Макс. температура стола, °C", type: "number" },
      { key: "surface", label: "Покрытие (PEI, стекло…)", type: "text" },
      { key: "auto_leveling", label: "Автовыравнивание", type: "text", placeholder: "sensorless, strain-gauge, none…" },
    ],
  },
  {
    key: "speed",
    label: "Скорость",
    fields: [
      { key: "max_speed_mms", label: "Макс. скорость, мм/с", type: "number" },
      { key: "max_accel_mms2", label: "Макс. ускорение, мм/с²", type: "number" },
      { key: "input_shaping", label: "Input shaping", type: "boolean" },
    ],
  },
  {
    key: "multimaterial",
    label: "AMS / мультиматериал",
    fields: [
      { key: "supported", label: "Поддерживается", type: "boolean" },
      { key: "system_name", label: "Название системы (AMS, MMU3…)", type: "text" },
      { key: "max_colors", label: "Макс. цветов", type: "number" },
      { key: "unique_notes", label: "Чем уникальна", type: "text" },
    ],
  },
  {
    key: "connectivity",
    label: "Связь",
    fields: [
      { key: "wifi", label: "Wi-Fi", type: "boolean" },
      { key: "ethernet", label: "Ethernet", type: "boolean" },
      { key: "usb", label: "USB", type: "boolean" },
      { key: "camera", label: "Камера", type: "boolean" },
      { key: "firmware", label: "Прошивка (Klipper, Marlin…)", type: "text" },
      { key: "moonraker", label: "Есть Moonraker API", type: "boolean" },
      { key: "lan_mode", label: "Работает без облака вендора", type: "boolean" },
    ],
  },
  {
    key: "dimensions_mm",
    label: "Габариты",
    fields: [
      { key: "w", label: "Ширина, мм", type: "number" },
      { key: "d", label: "Глубина, мм", type: "number" },
      { key: "h", label: "Высота, мм", type: "number" },
      { key: "weight_kg", label: "Вес, кг", type: "number" },
    ],
  },
  {
    key: "price",
    label: "Цена",
    fields: [
      { key: "msrp_usd", label: "Рекомендованная, USD", type: "number" },
      { key: "ru_rub", label: "Типичная цена РУ-рынка, ₽", type: "number" },
      { key: "ru_updated_at", label: "Цена РУ обновлена (дата)", type: "text", placeholder: "YYYY-MM-DD" },
    ],
  },
];

// Секции-списки строк (toolhead_extras исключён — это массив объектов, отдельный редактор).
export const LIST_SECTIONS: { key: "materials_supported" | "unique_features"; label: string; placeholder: string }[] = [
  { key: "materials_supported", label: "Поддерживаемые материалы", placeholder: "PLA, PETG, ABS, TPU…" },
  { key: "unique_features", label: "Уникальные особенности", placeholder: "Всё, что не влезло в поля выше…" },
];

export const TOOLHEAD_KIND_OPTIONS: FieldOption[] = [
  { value: "laser", label: "Лазер" },
  { value: "cnc-spindle", label: "ЧПУ-шпиндель" },
  { value: "cutter", label: "Каттер" },
  { value: "pen", label: "Перо/плоттер" },
  { value: "foodpaste", label: "Пищевая паста" },
  { value: "other", label: "Другое" },
];

// slugifyPart/deriveSlug — зеркало apps/api/src/printers/contract.ts 1:1 (тот же алгоритм),
// нужно клиенту для превью slug и для presign фото ДО первого «Сохранить».
export function slugifyPart(raw: string): string {
  return raw
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
}

export function deriveSlug(brand: string, model: string): string {
  return `${slugifyPart(brand)}.${slugifyPart(model)}`;
}

export function isValidSlug(value: string): boolean {
  return /^[\p{L}\p{N}-]+\.[\p{L}\p{N}-]+$/u.test(value);
}

// Полная плоская карта leaf-путей секций спек — используется для «заполнено N из M» (§2.2)
// и для авто-разворота секций, где уже есть данные агента.
export function sectionFieldPaths(section: SectionDef): string[] {
  return section.fields.map((field) => `${section.key}.${field.key}`);
}
