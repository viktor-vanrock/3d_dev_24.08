import { parseDocument } from "yaml";
import { ManifestDiagnosticError, MANIFEST_ERROR_CODE } from "./diagnostics.ts";
import { assertDepthAllowed, assertManifestSizeAllowed, MAX_MANIFEST_BYTES } from "./limits.ts";

// Безопасный YAML-парсинг portal.project.yaml (MF-1967, security suite: YAML-бомба/
// дублирующиеся ключи). Зависимость `yaml` (eemeli/yaml) — сознательный выбор поверх
// принятого в репо паттерна "не тянуть ajv/аналоги, схема простая — валидатор пишем сами"
// (apps/api/src/db/schemas/slicer-profile.schema.test.ts): та рекомендация — про валидацию
// СОБСТВЕННОЙ, контролируемой JSON Schema (см. schemaValidate.ts — здесь именно так и сделано,
// без внешней зависимости). YAML — другое: враждебная грамматика (anchors/aliases/tags), не
// наша схема, и здесь риск самодельного парсера выше пользы. `yaml` не резолвит произвольные
// теги (в отличие от небезопасных схем других YAML-библиотек), по умолчанию отклоняет
// дублирующиеся ключи документа и ограничивает суммарное число alias-разворотов
// (maxAliasCount, по умолчанию 100) — ровно то, что нужно против anchor/alias-бомбы
// (billion laughs), без ручной реализации этой защиты.

export interface SafeYamlParseResult {
  value: unknown;
}

export function safeParseManifestYaml(source: Buffer | string): SafeYamlParseResult {
  const text = typeof source === "string" ? source : source.toString("utf8");
  const byteLength = typeof source === "string" ? Buffer.byteLength(source, "utf8") : source.length;
  try {
    assertManifestSizeAllowed(byteLength);
  } catch (err) {
    throw new ManifestDiagnosticError(MANIFEST_ERROR_CODE.MANIFEST_TOO_LARGE, (err as Error).message);
  }

  let doc: ReturnType<typeof parseDocument>;
  try {
    // maxAliasCount оставлен на дефолте библиотеки (100) — сознательно не поднимаем: это и
    // есть порог защиты от anchor/alias-бомбы, поднятие лимита ослабляло бы её без пользы для
    // легитимных манифестов (ни один валидный portal.project.yaml не нуждается в 100+ alias).
    doc = parseDocument(text, { uniqueKeys: true, strict: true });
  } catch (err) {
    throw new ManifestDiagnosticError(MANIFEST_ERROR_CODE.MANIFEST_YAML_UNSAFE, (err as Error).message);
  }

  if (doc.errors.length > 0) {
    throw new ManifestDiagnosticError(MANIFEST_ERROR_CODE.MANIFEST_YAML_UNSAFE, doc.errors[0]!.message);
  }

  let value: unknown;
  try {
    // toJS() — момент, когда aliases фактически разворачиваются в память; excessive alias
    // count бросает здесь (не на parseDocument), maxAliasCount выше это покрывает.
    value = doc.toJS();
  } catch (err) {
    throw new ManifestDiagnosticError(MANIFEST_ERROR_CODE.MANIFEST_YAML_UNSAFE, (err as Error).message);
  }

  if (value === null || value === undefined) {
    throw new ManifestDiagnosticError(MANIFEST_ERROR_CODE.MANIFEST_NOT_AN_OBJECT, "документ пуст");
  }
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new ManifestDiagnosticError(MANIFEST_ERROR_CODE.MANIFEST_NOT_AN_OBJECT, `получен ${typeof value}`);
  }

  try {
    assertDepthAllowed(value);
  } catch (err) {
    throw new ManifestDiagnosticError(MANIFEST_ERROR_CODE.MANIFEST_TOO_LARGE, (err as Error).message);
  }

  return { value };
}

export { MAX_MANIFEST_BYTES };
