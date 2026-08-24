// Приоритет источника для разрешения конфликтов полей при merge (MF-406 п.3, декомпозиция
// MF-648): "вендор > структурный профиль > каталог > новость" из описания карточки. Само
// проставление source/confidence на machine_candidates — забота адаптера/runIngest (см.
// src/modules/catalog/infrastructure/ingest/types.ts), не этого пайплайна; здесь только классификация уже пришедшего
// source в один из четырёх уровней + свёртка с machine_candidates.confidence (тай-брейк внутри
// одного уровня, когда два источника одного класса расходятся).
//
// Список source id — по факту существующих адаптеров (src/modules/catalog/infrastructure/ingest/adapters/) и
// bootstrap-импорта; новый адаптер, не попавший ни под один паттерн, получает TIER_CATALOG —
// безопасный средний дефолт (не самый доверенный, не самый последний).
const TIER_NEWS = 0;
const TIER_CATALOG = 1;
const TIER_STRUCTURAL = 2;
const TIER_VENDOR = 3;

const KNOWN_VENDOR_SOURCES = new Set(["sovol3d-store"]);
const KNOWN_STRUCTURAL_SOURCES = new Set(["cura-definitions", "slicer-profiles-db"]);

function sourceTier(source: string): number {
  const id = source.toLowerCase();
  if (KNOWN_VENDOR_SOURCES.has(id) || /-store$|-official$/.test(id)) return TIER_VENDOR;
  if (KNOWN_STRUCTURAL_SOURCES.has(id) || /definitions|profiles/.test(id)) return TIER_STRUCTURAL;
  if (/news/.test(id)) return TIER_NEWS;
  return TIER_CATALOG;
}

/** Приоритет уже существующего значения поля, у которого нет провенанс-записи (ручной ввод/
 *  legacy-данные без source) — трактуем консервативно, как минимум наравне с самым уверенным
 *  catalog-источником: catalog-уровневый кандидат (даже с confidence=1) не перетирает
 *  непрослеженные данные молча, это делает только structural/vendor — задача явно говорит
 *  "не перезатирать молча", непрослеженное поле = потенциально курировано вручную. */
export const UNTRACKED_FIELD_SCORE = TIER_STRUCTURAL - 0.005;

/** Скор для сравнения "кто побеждает" при конфликте поля: уровень источника — основной сигнал,
 *  confidence (0..1, machine_candidates.confidence) — тай-брейк внутри одного уровня, никогда не
 *  дотягивается до следующего уровня (умножается на 0.99). */
export function sourcePriorityScore(source: string, confidence: number | null | undefined): number {
  const tier = sourceTier(source);
  const conf = typeof confidence === "number" && Number.isFinite(confidence) ? Math.min(Math.max(confidence, 0), 1) : 0.5;
  return tier + conf * 0.99;
}
