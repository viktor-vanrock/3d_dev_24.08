# MF-1349 — read-only проверка сиротских и дубль-связей

Дата среза: 2026-07-13. Среда: `portal_dev`. Выполнены только `SELECT`; DDL и DML
не использовались.

## Воспроизводимый запуск

```sh
set -a; . "$HOME/portal.api-dev.env"; set +a
psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -P pager=off \
  -f docs/verification/mf-1349-user-printer-orphans.sql
```

## Результаты

- `orphan_user_links = 0`: все строки `user_printers.user_id` ссылаются на
  существующего пользователя.
- `orphan_machine_links = 0`: среди непустых `printer_id` нет ссылок на
  отсутствующие `machines`. При этом `printer_id` пуст у всех строк, поэтому
  это не подтверждает наличие рабочих связей с каталогом.
- В таблице 54 строки и 47 различных пользователей; `null_user_ids = 0`,
  `nonnull_printer_ids = 0`.
- Найдена одна группа потенциального дубля: 3 строки одного пользователя
  `2affbc51-b39f-4b8b-a4c9-d2125c29643e` с `brand=Creality`,
  `model=Ender-3 V3 SE`, `printer_id IS NULL`. Идентификаторы строк:
  `107e3253-64a8-44d5-a2d8-267a8bca5254`,
  `7383daf7-f43a-44d5-86e3-8b8a45cfc350`,
  `fd78b6f-a844-4ed4-891b-0c7ddabd1003`.
- `duplicate_connection_external_ref = 0`; проверка применима только к
  строкам с непустым `connection_id`, которых в текущем срезе нет.
- На `user_printers` есть PK по `id`, индекс пользователя, индексы `agent_id`
  и `lan_endpoint`, а также частичный уникальный индекс
  `(connection_id, external_ref)` при `connection_id IS NOT NULL`. Уникального
  ограничения на `(user_id, printer_id, brand, model)` нет.

## Интерпретация и ограничения

В текущем dev-срезе целостность owner-связей не нарушена, но декларативная
связь не дедуплицируется по владельцу и описанию модели: один пользователь
имеет три одинаковые записи. Это наблюдение, а не разрешение удалять строки.
`printer_id` пока не позволяет проверить фактические связи с `machines`, так
как все значения NULL. Результаты зависят от состояния dev-БД на дату среза.

## Lineage

Карточка: MF-1349 → направление MF-1268 → основание MF-1076. Контекст схемы:
[docs/architecture/device.tables.md](../architecture/device.tables.md),
[docs/verification/mf-1312-user-printer-relations.md](mf-1312-user-printer-relations.md),
[docs/api.public.md](../api.public.md).
