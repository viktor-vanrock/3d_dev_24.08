# `slice-trust.v1`: канонический `config_fingerprint` и подпись слайса

**Решение MF-1688.** Шов `packages/contracts/jobs/slicer.ts` принадлежит двум сторонам:
Gateway/Devices владеет `account_id`, `user_printers` и авторизацией API; Mesh владеет
исполнением слайсинга и подписью готового G-code. Каталог/Data владеет значениями стоковой модели,
но не пишет состояние экземпляра устройства. Это сохраняет account↔printer identity и не даёт
Mesh самостоятельно подменять config identity.

Источники: [service.map.md](../architecture/service.map.md) §1–3,
[data.fragmentation.md](../architecture/data.fragmentation.md) §§1–2,7,9,
[printer.server.md](../architecture/printer.server.md),
[device.tables.md](../architecture/device.tables.md), [trust.md](../product/trust.md) §§1,4 и
«Граница v1», MF-902.

## Версия и детерминированный fingerprint

`contract_version` — ровно `slice-trust.v1`; алгоритм стокового fingerprint — ровно
`config-fingerprint.v1`. Это SHA-256 от UTF-8 строки JSON без пробелов с таким фиксированным
порядком ключей:

```json
{"build_volume_mm":{"x":220,"y":220,"z":240},"firmware_family":"klipper","firmware_revision":"v0.12.0","kinematics":"cartesian","nozzle_diameter_um":400,"printer_model_id":"ender-3-v3-ke","stock_profile_id":"creality/ender-3-v3-ke/0.4"}
```

Внешний объект входа не влияет на порядок: допустимы только семь полей выше, а у
`build_volume_mm` — только `x`, `y`, `z`. `printer_model_id`, `stock_profile_id`,
`firmware_family` и `kinematics` проходят `trim` + lower-case; `firmware_revision` — только
`trim` и печатные ASCII `[A-Za-z0-9._-]`; сопло — целое число микрометров, размеры — положительные
целые миллиметры. Unknown/missing field, дробный размер, пустое значение или иной символ — ошибка
контракта, а не «починка» входа. Фикстура даёт fingerprint
`b4f62fa5e32a92358fcac6f0f922f15140892ffa156742b63a97471d0efcc63b`.

## Источник и граница v1

| Состояние / источник | `config_fingerprint` | `canonical_config_fingerprint` | Допуск v1 |
|---|---|---|---|
| `stock` + `agent` | SHA-256 канонического входа | тот же hash | Только cache/dispatch текущего аккаунта |
| `stock` + `declared` | SHA-256 канонического входа | тот же hash | Только cache/dispatch текущего аккаунта; заявление не становится доказательством |
| `custom`/`mismatch` + `agent` | индивидуальный 64-hex `agent-config.v1` | `null` | Только точная account-scoped связка |
| `custom`/`mismatch` + `declared` | запрещено | `null` | API отклоняет запрос: нет факта агента |

`fingerprint_source=agent` означает только принятый Gateway факт от привязанного,
аутентифицированного агента; он не заменяет проверку владения устройством. `declared` — декларация
из `user_printers`, не доказательство. Во всех строках v1 устанавливает
`cross_account_reuse=false` и `global_dedup_eligible=false`: ни совпадающий hash, ни подпись не
включают global cache-hit, LAN/P2P или репутационный сигнал.

## API, Mesh и подпись

Gateway формирует `SliceTrustMaterial` только после authN/authZ: сессия или key должны иметь право
на `account_id` и `device_id`; `device_id` обязан принадлежать этому аккаунту, а `profile_id` —
быть разрешённой версией профиля. Он передаёт Mesh material вместе с job. Mesh не принимает
свободный fingerprint из очереди и не меняет account/device/profile.

В API v1 запрос `POST /models/:id/slice` обязан содержать `profile_id`, `device_id` и вложенный
`slice_trust` с `contract_version`, `slice_key`, `fingerprint_source`, `fingerprint_state` и
соответствующим доказательством (`stock_input` для stock либо `config_fingerprint` + `agent-config.v1`
для custom/mismatch). Для `fingerprint_source=agent` вместе с пользовательской сессией предъявляется
Bearer credential привязанного агента; его `owner_id`, `device_id` и `agent_id` сверяются с БД.
`declared` не требует agent credential, но остаётся account-scoped заявлением. В очередь пишутся только
сформированный material и его версия — `stock_input` не сохраняется и не попадает в ответ/лог.

Отсутствующая или неизвестная версия даёт `409 SLICE_TRUST_VERSION_UNSUPPORTED`, ошибка формы или
доказательства — `400 SLICE_TRUST_INVALID`, чужая account↔device связка — неразличимый `404`, а
повторный account-scoped ключ с другим material — `409 SLICE_TRUST_CONFLICT`. Повтор с тем же material
возвращает ту же job идемпотентно. Legacy job не получает trust-material fallback.

Перед сохранением G-code Mesh передаёт signer точный результат
`serializeSliceTrustMaterial(material)`. В нём фиксированно присутствуют `contract_version`,
`slice_key`, `config_fingerprint`, canonical fingerprint (или `null`), account/device/profile,
source/state/algorithm и оба v1 gate. Detached signature и `key_id` хранятся вместе с результатом;
проверяющий сверяет подпись этой строки до выдачи/dispatch. Формат ключа и Ed25519-реализация не
являются частью данного TS-контракта, но другой алгоритм требует новую версию контракта.

Идемпотентность: API использует существующий `(account_id, slice_key, user_id, model_id)` cache-hit
gate и тот же material при повторе job. Mesh не создаёт новый артефакт, если его подпись и material
уже совпали; несовпадение material для того же account-scoped ключа — `409`/`SLICE_TRUST_CONFLICT`,
без перезаписи. Нет `account_id`/права/связки — неразличимый `404`; некорректный контракт —
`400 SLICE_TRUST_INVALID`; неизвестная/старая версия — `409 SLICE_TRUST_VERSION_UNSUPPORTED`.

Наблюдаемость: Gateway и Mesh пишут `contract_version`, `fingerprint_source`, `fingerprint_state`,
`fingerprint_algorithm_version`, outcome (`accepted|rejected|signature_verified`) и correlation/job
id. Нельзя писать raw config, подпись, S3 URL, IP, токен или G-code. Метрики: счётчики отказов по
коду и source/state, signature verification failures, попытки cross-account reuse.

## Совместимая миграция и MF-902

1. Gateway начинает записывать versioned material в новую job/result metadata и принимает только
   `slice-trust.v1` для новых job; legacy results не получают автоматический fallback.
2. Mesh читает v1, подписывает exact material и возвращает signature metadata; rollout наблюдается
   по version/outcome, без изменения device-agent.
3. API/dispatch требует совпадения подписанного material с текущими account/device/profile и
   возвращает `409` для legacy/несовместимого результата. Старые неподписанные джобы остаются
   читаемыми только по прежнему account-scoped пути, но не dispatch/P2P-совместимы.
4. Только после отдельного решения CTO по MF-902 можно ввести новую версию, которая разрешит
   доказанный `agent + stock` global cache-hit, затем LAN внутри аккаунта и лишь потом P2P между
   аккаунтами. `declared`, custom и mismatch не являются shortcut для этого перехода.
