# MF-1312: read-only проверка ограничений и кардинальностей user↔printer

Дата: 2026-07-12. Контур: только SQL-проверки и документация. DDL/DML не
использовались.

## Что проверялось

Проверены PK/FK/UNIQUE/CHECK для `user_printers`, nullability ключевых колонок и
фактические кардинальности связей `user ↔ user_printers ↔ printer/connection`
в `portal_dev`.

## Воспроизводимый запуск

```sh
set -a; . "$HOME/portal.api-dev.env"; set +a
psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -P pager=off \
  -f docs/verification/mf-1312-user-printer-relations.sql
```

## Фактический результат на dev

- `user_printers` имеет PK `id`, FK на `users`, `machines`, `printer_connections`,
  `agents`, `fleets`, `zones`.
- Единственный FK невалидирован на исторических строках: `user_printers_printer_id_fkey`
  (`printer_id -> machines(id) NOT VALID`).
- Частные проверки по уникальности `connection_id + external_ref` нарушений не
  показали.
- Кардинальность по данным:
  - 54 строки `user_printers`
  - 47 пользователей с принтерами
  - от 1 до 8 принтеров на пользователя
  - среднее 1.15 принтера на пользователя
  - 1 пользователь имеет больше одного принтера
- `printer_id` в текущем dev-срезе пустой у всех 54 строк, `connection_id` тоже
  пустой у всех 54 строк.
- `agent_id` заполнен в 3 строках.
- `brand` и `model` заполнены во всех 54 строках.

## Связь с MF-1076

MF-1076 добавляет `user_api_keys` и fingerprint-слой для `printers`/`user_printers`,
но не меняет базовую ownership-модель:

- [docs/architecture/device.tables.md](../architecture/device.tables.md#связь-с-mf-1076-mf-884-и-mf-1050)
- [docs/epics/domain.model.md](../epics/domain.model.md)

Практический вывод по текущей схеме: `user_printers.user_id` остаётся
единственной фактической owner-связью, а `printer_id` в этом dev-срезе ещё не
участвует в данных и не даёт рабочих join-ов по каталожным принтерам.

