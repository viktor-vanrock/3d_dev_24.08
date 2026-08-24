# Контракт публичного каталога принтеров `printers.catalog.v1`

**Решение MF-1652 · lineage:** MF-1650, MF-1649, MF-1470; [дизайн](../design/printers.catalog.md) §§2.10, 3, 5, 7 и [эпик](../epics/printers.research.md) §9.

## Решение

Владелец данных и producer — **Data**, каноническая таблица `printers`; consumer — **Front**. Шов — `packages/contracts/http/printers.ts`; endpoint остаётся публичным `GET /printers`, без сессии, cookie или персональных полей. `user_printers`, device identity, LAN endpoint, config fingerprint, telemetry и P2P не входят в выдачу: карточка описывает модель, а не экземпляр. Это сохраняет account↔printer identity и не ограничивает будущую P2P-модель v2/v3.

Версия ответа обязательна: `contract_version: "printers.catalog.v1"`. Публичный тип — `PrinterCatalogPage`; новые поля добавляются только опционально. Удаление/переименование или изменение смысла поля — новая версия контракта.

### Запрос

`GET /printers` — безопасный и идемпотентный read-запрос; `Idempotency-Key` не нужен. Параметры первой страницы:

| Группа | Параметры |
|---|---|
| Поиск и наборы | `q`, `brand`, `type`, `kinematics`, `status`, `capabilities`, `materials`, `connectivity`, `support_level` |
| Числа | `currency=rub|usd`, `price_min`, `price_max`, `fits_x`, `fits_y`, `fits_z`, `hotend_min`, `bed_min`, `flow_min`, `speed_min` |
| Флаги | `swappable_nozzle=1` и capability из словаря контракта |
| Порядок | `sort=recommended|relevant|new|price_asc|price_desc|build_volume`; `relevant` допустим только с непустым `q`, иначе producer нормализует в `recommended` |
| Пагинация | `limit=24` (фиксирован v1), затем `cursor` |

Множественные значения передаются одним параметром через запятую в URL (`brand=creality,bambu-lab`, `capabilities=ams,enclosed`); значения нормализованы и отсортированы producer перед формированием cursor. Отсутствующий параметр не фильтрует. `q` ограничен 200 символами после trim. Некорректное значение, диапазон (`price_min > price_max`) или cursor дают `400 invalid_query`/`invalid_cursor` и не заменяются молча.

Cursor — непрозрачная строка: web не декодирует, не конструирует и не сохраняет в URL как независимое состояние. `next_cursor` действителен только с теми же нормализованными фильтрами, sort, currency и limit, что породили его. На «Показать ещё» web отправляет исходный query плюс ровно этот `cursor`; изменение любого фильтра/sort/currency сбрасывает items и cursor и запускает первую страницу. Producer связывает cursor с fingerprint нормализованного query и отвергает несовпадение `400 invalid_cursor`.

### Ответ

Обязательная форма:

```json
{
  "contract_version": "printers.catalog.v1",
  "items": [{
    "id": "uuid", "slug": "creality.k1-max", "brand": "Creality", "model": "K1 Max",
    "status": "shipping", "verified": true, "image_url": null,
    "price": { "rub": 54900, "usd": 599, "rub_updated_at": "2026-07-15" },
    "build_volume_mm": { "x": 300, "y": 300, "z": 300 },
    "kinematics": "corexy", "capabilities": ["enclosed"]
  }],
  "has_more": true,
  "next_cursor": "opaque-cursor",
  "gap_counts": { "ams": 2 }
}
```

`has_more` **равно** `next_cursor !== null`; при `false` `next_cursor` строго `null`. `items` могут быть короче 24 только на последней странице. `id`, `slug`, бренд, модель, статус, `verified`, `image_url`, price, объём, кинематика и capabilities обязательны, но их значимые неизвестные значения отдаются `null`/`[]`, а не выдумываются. Это достаточная форма для `PrinterTile`; detail остаётся отдельным `GET /printers/:slug`.

`gap_counts` содержит только активные фасеты, где `null` исключён из обычной выдачи; значение — неотрицательное число подходящих по остальным фильтрам моделей с неизвестным полем. Оно питает один `GapRow`, не скрывает модели. Фасеты с известным `false` не считаются пробелом.

### Примеры страниц и ошибки

| Сценарий | Запрос | Инвариант ответа |
|---|---|---|
| Первая | `?brand=creality&capabilities=ams&sort=price_asc` | `has_more=true`, `next_cursor` непустой; web заменяет сетку |
| Следующая | тот же query + `cursor=<opaque>` | первые items не повторяются; web дописывает по `id`, затем заменяет cursor |
| Последняя | тот же query + следующий cursor | `has_more=false`, `next_cursor=null`; «Показать ещё» отсутствует/disabled |
| Сеть или 5xx | тот же GET | данные текущей сетки не подменяются fixture; первый load — 8 skeleton, затем «Каталог не отвечает. Обновить»; retry повторяет ту же первую/следующую страницу без изменения query |

`401`/`403` для read-маршрута — defect producer, не состояние экрана. `404` относится только к detail slug. Ошибки запроса имеют `{ "error": "invalid_query"|"invalid_cursor", "request_id": "..." }`; 5xx не раскрывает SQL/cursor. Producer записывает структурированные `request_id`, нормализованный `catalog_query_hash`, `cursor_present`, `items_count`, `has_more`, latency и код ошибки; не логирует сам `q`, cursor, cookies или IP.

## Migration path

Текущий `/printers` с `offset`, полем `printers` и fixture в web не является consumer-совместимым v1. Data сначала добавляет ответ v1 за тем же GET, временно может сохранять legacy `printers` только как аддитивный переходный alias; Front переключается исключительно на `items/has_more/next_cursor` и удаляет fixture. После наблюдаемой интеграционной проверки alias удаляется отдельной совместимой задачей. Ни API, ни Front не реализуют P2P в v1.
