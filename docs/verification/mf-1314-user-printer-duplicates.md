# MF-1314 — проверка дублей связей user↔printer

Дата среза: 2026-07-15, `portal_dev`, роль `portal_dev`. Выполнены только
`SELECT` и чтение метаданных PostgreSQL внутри `transaction read only`; DDL и
DML не выполнялись. Воспроизводимый запрос: [`mf-1314-user-printer-duplicates.sql`](mf-1314-user-printer-duplicates.sql).

## Критерий дубля

Каноническая запись экземпляра — `user_printers`; владелец определяется
`user_printers.user_id`. `printer_id` — nullable-ссылка на каталог `machines`, а
не идентификатор физического экземпляра. Поэтому одинаковые `user_id + printer_id`
или нормализованные `user_id + brand + model` — только кандидаты: у пользователя
могут быть два одинаковых принтера.

Жёсткими дублями считаются:

- повтор `(connection_id, external_ref)` для connector-принтера;
- повтор `(device_id, user_id)` в `device_shares`;
- повтор `(user_id, provider)` в `printer_connections`;
- более одной `is_primary`-строки у одного пользователя.

Схема защищает первые три ключа уникальными индексами/ограничениями. Для
ручного и agent-подключения стабильного instance-id в `user_printers` нет.

## Результат dev

| Проверка | Результат | Интерпретация |
|---|---:|---|
| `user_printers` | 85 строк / 72 владельца | объём среза |
| `printer_id IS NOT NULL` | 2 | каталожные ссылки |
| `connection_id IS NOT NULL` | 0 | connector-срез пуст |
| `duplicate_connection_external_ref` | 0 групп / 0 строк | дублей нет |
| `connector_rows_without_external_ref` | 0 групп / 0 строк | уязвимый NULL-кейс не наблюдается |
| `duplicate_user_catalog_candidate` | 0 групп / 0 строк | совпадений по каталожному ключу нет |
| `duplicate_user_brand_model_candidate` | 3 группы / 8 строк | только эвристические кандидаты |
| `multiple_primary_per_user` | 0 пользователей / 0 строк | повторных primary нет |
| `users_without_primary` | 2 пользователя / 15 строк | dev/test-состояние, не дубль |
| `duplicate_device_share` | 0 групп / 0 строк | повторных user↔device связей нет |
| `duplicate_connection_account` | 0 групп / 0 строк | повторных connector-аккаунтов нет |
| разрыв owner коннектора | 0 | `pc.user_id = up.user_id` |
| сирота `connection_id` | 0 | FK-связь цела |
| сирота `printer_id` | 0 | текущие `machines` существуют |
| сирота `device_shares.device_id` | 0 | FK-связь цела |
| ожидаемое owner-share пересечение | 9 | штатная owner-строка enroll, не дубль |

Три эвристические группы относятся к одному dev-пользователю с тестовыми
записями: `Creality / Ender-3 V3 SE` — 3 строки (`manual`), `Klipper / MF-1331
live retry test` — 3 строки (`agent`) и `Klipper / MF-1511 Polygon dev relay QA` —
2 строки (`agent`). По одной только схеме нельзя доказать, что это повторная
отправка вместо нескольких физических экземпляров; удаление или слияние строк
не выполнялось.

## Schema ↔ API и lineage MF-1076

- `apps/api/src/printers/prusaConnect.sync.ts` использует upsert по
  `(connection_id, external_ref)`, что соответствует уникальному partial index
  `user_printers_connection_ref_idx`. Текущий dev не содержит connector-строк,
  поэтому проверен только контракт схемы и отсутствие нарушений.
- `apps/api/src/devices/shares.route.ts` повторно назначает share через
  `ON CONFLICT (device_id, user_id) DO UPDATE`; это согласовано с уникальным
  ограничением и проверено нулём дублей.
- `POST /me/printers` в `apps/api/src/profile/activation.ts` всегда делает
  `INSERT` и не имеет idempotency key или стабильного instance-id. Это не
  зафиксированный дефект данных, но schema↔API-разрыв для требования «повторная
  отправка той же ручной привязки не плодит строки»: текущий API не обещает такую
  идемпотентность. Добавлять UNIQUE по бренду/модели нельзя без решения о
  поддержке нескольких одинаковых физических принтеров.
- MF-1076 добавляет `user_api_keys` и fingerprint-поля, но по
  [`device.tables.md`](../architecture/device.tables.md#связь-с-mf-1076-mf-884-и-mf-1050)
  не меняет каноническую ownership-модель `user_printers` и не добавляет новый
  ключ дедупликации. Fingerprint — будущий атрибут экземпляра/модели, а не
  доказательство дубля текущих ручных связей.

## Вывод

На срезе `portal_dev` фактических жёстких дублей user↔printer, повторных share- или
connector-назначений не найдено. Есть 8 эвристических совпадений бренд/модель,
все в dev/test-данных; они требуют бизнес-идентификатора физического экземпляра
или явной идемпотентности API, прежде чем считать их ошибками. DDL/DML и очистка
данных для MF-1314 не нужны.
