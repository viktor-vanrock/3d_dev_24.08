# MF-1271: read-only инварианты device-схемы

Дата: 2026-07-12. Контур: только SQL-проверки и документация. Запросы ниже не
содержат DDL и не изменяют данные. Они рассчитаны на PostgreSQL dev-базы.

## Что проверяется

Канонический экземпляр устройства — `user_printers`; его владелец —
`user_printers.user_id`. Таблицы состояния, telemetry, jobs и shares должны
ссылаться на существующий экземпляр. `capabilities` — JSON-объект, а
`config_fingerprint_source` — `agent` или `declared`. Кэш слайсинга разделён на
общую content-addressed запись и приватные hits пользователя.

## Воспроизводимый запуск

```sh
set -a; . "$HOME/portal.api-dev.env"; set +a
psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -P pager=off \
  -f docs/verification/mf-1271-device-schema-invariants.sql
```

В репозитории сохранён именно SQL-файл, чтобы проверки можно было запускать без
копирования команд: `docs/verification/mf-1271-device-schema-invariants.sql`.

## Ожидаемый результат

Все проверки с суффиксом `_violations` должны вернуть `0`; проверки
`api_shape_mismatches` и `cache_hit_orphans` — `0 строк`. Запросы, выдающие
фактические строки, предназначены для расследования, а не для исправления
данных.

На dev 2026-07-12 получено: сироты и enum/NULL-нарушения — `0`, дубли
fingerprint/key — `0`, cache hit без entry — `0`; `capabilities_not_exposed = 0`
и `blank_connector_type = 0` (в текущем срезе capabilities пусты либо API-shape
не нарушен). Проверка API-контракта всё равно оставлена как регрессия: SQL
хранит capability экземпляра, а v0 serializer должен явно синхронизировать его
представление с контрактом. Это согласуется с независимым аудитом
[MF-1269](mf-1269-device-capabilities-audit.md).

## Связь с предыдущими решениями

- [MF-1076](../architecture/device.tables.md#связь-с-mf-1076-mf-884-и-mf-1050):
  разделяет `user_api_keys` и fingerprint модели/экземпляра.
- [MF-884](../architecture/device.tables.md#связь-с-mf-1076-mf-884-и-mf-1050):
  каталожные capability/support-поля принадлежат `printers`, не live device.
- [MF-1050](../architecture/device.tables.md#связь-с-mf-1076-mf-884-и-mf-1050):
  каталог и `/v0/printers*` имеют разные API-представления.
