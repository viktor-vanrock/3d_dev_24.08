# MF-1120: `GET /printers` read-resolver smoke

Проверено на dev-контуре авторизованной служебной сессией (`2026-07-12`):

```text
GET https://api.dev.3mf.tech/printers?limit=5
HTTP 200
```

Ответ содержит верхнеуровневые поля `printers`, `has_more` и `gap_counts`.
Fixture `creality.k1-max` содержит `id`, `slug`, `brand`, `model`, `status`,
`kinematics`, `type`, `build_volume`, capability-поля `enclosed`,
`multimaterial_supported`, `has_laser`, `has_cnc`, а также `price` с
`msrp_usd`, `ru_rub` и `ru_updated_at`. Для текущего fixture `has_more=false`
и `gap_counts={}`.

Фасеты `capability=fdm` и `capability=laser` отвечают HTTP 200. Фасет цены
`price_min=1&price_max=1000` возвращает пустой `printers`, что подтверждает
применение рублёвого диапазона к fixture с MSRP 699 USD. Канон параметров
цены: `price_min`/`price_max`; альтернативные имена молча игнорируются.

