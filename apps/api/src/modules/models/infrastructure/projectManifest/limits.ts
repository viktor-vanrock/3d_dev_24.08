// Лимиты приёма манифеста (MF-1967) — та же защита от resource-exhaustion, что git/limits.ts
// и models/formats.ts §1.8 zip-лимиты, применённая к YAML-документу вместо файла/архива.

/** Манифест — небольшой декларативный текст, не бинарник; 1 МБ с большим запасом покрывает
 * даже крупный многокомпонентный проект (fixtures/multi-component.v1.yaml — на два порядка меньше). */
export const MAX_MANIFEST_BYTES = 1 * 1024 * 1024;

/** Глубина вложенности объектов/массивов YAML-документа — защита от stack-overflow при
 * рекурсивном обходе (валидатор/резолвер), независимо от anchor/alias-лимита самого парсера. */
export const MAX_MANIFEST_DEPTH = 32;

/** Верхняя граница на любой список манифеста при доп. проверке помимо maxItems самой схемы —
 * schema.v1.json уже ограничивает каждый список персонально; это общий backstop для обхода
 * рекурсивного подсчёта (например, суммарное число *Refs на один компонент). */
export const MAX_REFS_PER_ENTITY = 5000;

export function assertManifestSizeAllowed(byteLength: number): void {
  if (byteLength > MAX_MANIFEST_BYTES) {
    throw new Error(`portal.project.yaml превышает лимит ${MAX_MANIFEST_BYTES} байт (${byteLength})`);
  }
}

/** Глубина вложенности — считаем после парсинга (структура уже материализована в памяти;
 * anchor/alias-бомбу ловит yaml-парсер раньше, до этой проверки, см. yamlSafe.ts). */
export function assertDepthAllowed(value: unknown, depth = 0): void {
  if (depth > MAX_MANIFEST_DEPTH) {
    throw new Error(`portal.project.yaml превышает лимит вложенности ${MAX_MANIFEST_DEPTH}`);
  }
  if (Array.isArray(value)) {
    for (const item of value) assertDepthAllowed(item, depth + 1);
    return;
  }
  if (value && typeof value === "object") {
    for (const item of Object.values(value as Record<string, unknown>)) assertDepthAllowed(item, depth + 1);
  }
}
