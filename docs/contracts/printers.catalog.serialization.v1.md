# Сериализация capability каталожного принтера v1

**Решение MF-1231 · lineage:** [архитектура printer server](../architecture/printer.server.md), [публичный API](../api.public.md), [схема карточки](../research/printer.schema.json), [каталог v1](printers.catalog.v1.md) и MF-1076.

## Граница и source of truth

Этот контракт задаёт detail DTO `printer` для `GET /printers/:slug` и исследовательских
`/research/printers`-ответов. Он описывает **модель** каталога, не экземпляр устройства: user
ownership, IP/LAN endpoint, telemetry, agent credentials и command capability сюда не входят.

`printers.specs` — основной источник только для известных полей schema v1. Реляционные facet-колонки
остаются совместимым fallback: если section отсутствует, не object либо его leaf невалиден, serializer
использует валидное column-значение. Поэтому старые записи с пустым `specs={}` не теряют build volume,
hotend, price или connectivity. JSONB никогда не выдаётся клиенту целиком.

## Нормализованная форма

Обязательные database identity-поля `id`, `slug`, `brand`, `model`, `status`, `verified` и `_meta`
сохраняют прежние имена. Все необязательные scalar-поля отдаются как корректное значение или `null`.
Все коллекции (`aliases`, `toolhead_extras`, `materials_supported`, `unique_features`, `media.gallery`,
`sources`, `_meta.gaps`) отдаются как массив, при отсутствии — `[]`.

Всегда присутствуют section-объекты `build_volume`, `hotend`, `bed`, `speed`, `multimaterial`,
`connectivity`, `dimensions_mm`, `price` и `media`. Их leaf-поля идут в фиксированном schema-v1
порядке и имеют значение либо корректного типа, либо `null`; у `multimaterial.supported` безопасный
default — `false`. Строки trim-ятся, списки deduplicate и сортируются. Число может прийти от PostgreSQL
как numeric string и превращается в конечное JSON number; `NaN`/Infinity и некорректные строки не
публикуются.

`toolhead_extras[].kind` допускает только `laser`, `cnc-spindle`, `cutter`, `pen`, `foodpaste`,
`other`. Неизвестный элемент legacy JSON пропускается. Detail DTO не принимает произвольный
`capabilities`-массив; публичный каталог строит его только из allowlist
`ams`, `laser`, `cnc`, `enclosed`, `auto_leveling`, `hardened`, `moonraker`, `lan_mode`.
`bed_auto_leveling="none"` capability не создаёт. Неизвестный `capabilities` в query — `400
invalid_query` до обращения к БД.

Такая форма делает `JSON.stringify` детерминированным для одинаковых логических данных: serializer
формирует fields и objects в фиксированном порядке; provenance-объекты дополнительно сортируются по
ключу. Это позволяет использовать golden fixtures без зависимости от порядка ключей PostgreSQL JSONB.

## Совместимость и rollback

Изменение аддитивно: прежние top-level поля и section names сохранены; legacy column facets остаются
fallback. Новая миграция не нужна. Rollback — revert commit MF-1231: он возвращает предыдущий
serializer, не затрагивая данные или API routing. Перед rollback достаточно снова прогнать
`serialize.test.ts` и `catalog/printers.test.ts`; cache/data backfill не требуется.
