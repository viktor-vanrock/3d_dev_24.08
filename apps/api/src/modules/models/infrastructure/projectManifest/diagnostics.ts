// Таксономия ошибок резолвера манифеста (MF-1967), по аналогии с docs/epics/formats.policy.md
// §6 (upload-валидатор): конкретные коды на конкретные классы ошибок, не общий INVALID.
// FORMAT_ERROR_CODE (apps/api/src/models/formats.ts) остаётся отдельным контрактом (upload
// одного файла) — эта таблица про манифест/resolved-graph, коды не пересекаются по имени.

export const MANIFEST_ERROR_CODE = {
  /** YAML не парсится вовсе (синтаксис) или парсер отклонил его как небезопасный
   * (anchor/alias-бомба, дублирующиеся ключи центрального документа). */
  MANIFEST_YAML_UNSAFE: "MANIFEST_YAML_UNSAFE",
  /** Манифест превышает лимит размера/глубины вложенности (limits.ts) — защита от исчерпания
   * памяти/стека до попытки распарсить содержимое. */
  MANIFEST_TOO_LARGE: "MANIFEST_TOO_LARGE",
  /** Верхний уровень манифеста — не JSON-объект после парсинга YAML (например, список/скаляр). */
  MANIFEST_NOT_AN_OBJECT: "MANIFEST_NOT_AN_OBJECT",
  /** schemaVersion отсутствует или не входит в поддерживаемые резолвером версии. */
  MANIFEST_UNKNOWN_VERSION: "MANIFEST_UNKNOWN_VERSION",
  /** Структурная невалидность относительно schema.v1.json (лишнее поле вне x-*, неверный тип,
   * отсутствует обязательное поле, значение вне enum/pattern и т.п.). */
  MANIFEST_SCHEMA_INVALID: "MANIFEST_SCHEMA_INVALID",
  /** artifacts[].path выходит за пределы дерева проекта (абсолютный путь, `..`-сегмент). */
  MANIFEST_PATH_TRAVERSAL: "MANIFEST_PATH_TRAVERSAL",
  /** Путь артефакта на импортируемом входе — symlink или git submodule (gitlink), а не обычный
   * файл/дерево: небезопасно резолвить содержимое без выхода за пределы проекта. */
  MANIFEST_UNSAFE_ENTRY: "MANIFEST_UNSAFE_ENTRY",
  /** ZIP-контейнер импорта (составной 3MF) превышает лимиты распаковки (§1.8 formats.policy.md) —
   * тот же код, что upload-валидатор, для того же класса атаки. */
  MANIFEST_DECOMPRESSION_LIMIT: "MANIFEST_DECOMPRESSION_LIMIT",
  /** artifacts[].path не найден среди файлов импортируемого входа. */
  MANIFEST_ARTIFACT_MISSING: "MANIFEST_ARTIFACT_MISSING",
  /** artifacts[].checksum задан автором и не совпадает с фактическим содержимым файла. */
  MANIFEST_CHECKSUM_MISMATCH: "MANIFEST_CHECKSUM_MISMATCH",
  /** Ссылка (например bom[].vendor.url) использует запрещённую схему/хост — SSRF-guard. */
  MANIFEST_DISALLOWED_URL: "MANIFEST_DISALLOWED_URL",
  /** Два элемента одного или разных списков (artifacts/components/bom/connections/phases/
   * configurations) заявляют один и тот же id — ссылки стали бы неоднозначны. */
  MANIFEST_DUPLICATE_ID: "MANIFEST_DUPLICATE_ID",
  /** *Refs/dependsOn/from/to ссылается на id, которого нет среди объявленных сущностей. */
  MANIFEST_DANGLING_REF: "MANIFEST_DANGLING_REF",
  /** phases[].dependsOn образует цикл — DAG обязателен ациклическим. */
  MANIFEST_PHASE_CYCLE: "MANIFEST_PHASE_CYCLE",
  /** Вход содержит больше одного файла, но portal.project.yaml среди них нет — вырожденный
   * синтез применим только к ровно одному файлу (§ MF-1967 acceptance «простой одиночный
   * STL/3MF»), для остального многофайлового входа манифест обязателен. */
  MANIFEST_REQUIRED_FOR_BUNDLE: "MANIFEST_REQUIRED_FOR_BUNDLE",
} as const;

export type ManifestErrorCode = (typeof MANIFEST_ERROR_CODE)[keyof typeof MANIFEST_ERROR_CODE];

export class ManifestDiagnosticError extends Error {
  constructor(
    public readonly code: ManifestErrorCode,
    message: string,
    /** JSON-pointer-подобный путь до узла манифеста, где обнаружена проблема (для UI/логов). */
    public readonly path?: string,
  ) {
    super(`${code}: ${message}${path ? ` (${path})` : ""}`);
    this.name = "ManifestDiagnosticError";
  }
}

export const MANIFEST_ERROR_MESSAGE: Record<ManifestErrorCode, string> = {
  MANIFEST_YAML_UNSAFE: "Манифест не прошёл безопасный YAML-парсинг (синтаксис, дублирующиеся ключи или anchor/alias-бомба).",
  MANIFEST_TOO_LARGE: "Манифест превышает допустимый размер или глубину вложенности.",
  MANIFEST_NOT_AN_OBJECT: "portal.project.yaml обязан быть YAML-документом верхнего уровня типа 'объект'.",
  MANIFEST_UNKNOWN_VERSION: "Неизвестная или неподдерживаемая версия schemaVersion.",
  MANIFEST_SCHEMA_INVALID: "Манифест не соответствует JSON Schema project-manifest v1.",
  MANIFEST_PATH_TRAVERSAL: "Путь артефакта выходит за пределы дерева проекта.",
  MANIFEST_UNSAFE_ENTRY: "Путь артефакта указывает на symlink или git submodule — небезопасно резолвить.",
  MANIFEST_DECOMPRESSION_LIMIT: "Контейнер импорта превышает лимиты распаковки.",
  MANIFEST_ARTIFACT_MISSING: "Артефакт манифеста не найден среди файлов импортируемого входа.",
  MANIFEST_CHECKSUM_MISMATCH: "Контрольная сумма артефакта не совпадает с фактическим содержимым.",
  MANIFEST_DISALLOWED_URL: "Ссылка использует запрещённую схему или адрес.",
  MANIFEST_DUPLICATE_ID: "Идентификатор сущности манифеста дублируется.",
  MANIFEST_DANGLING_REF: "Ссылка манифеста указывает на несуществующий идентификатор.",
  MANIFEST_PHASE_CYCLE: "Граф фаз сборки (phases[].dependsOn) содержит цикл.",
  MANIFEST_REQUIRED_FOR_BUNDLE: "Пачка из нескольких файлов требует portal.project.yaml — вырожденный синтез применим только к одиночному файлу.",
};
