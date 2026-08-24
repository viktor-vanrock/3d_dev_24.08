# Контракт подбора профиля `slicer.profile-recommendation.v1`

## Эндпоинт

`GET /slicer-profiles/:printerId/:filamentId?intent=strength|speed|appearance|miniatures`

Маршрут требует сессию. `printerId` — необнаружимый UUID каталога `machines`, `filamentId` — необнаружимый UUID записи `materials` с `kind='filament'`. Отдельного листинга профилей нет: один запрос возвращает только результат для явно заданной связки. На маршрут действует многофакторный троттлинг по пользователю, IP и fingerprint (`429`, `Retry-After`).

## Ответ `200`

```json
{
  "contract_version": "slicer.profile-recommendation.v1",
  "printer_id": "uuid",
  "filament_id": "uuid",
  "intent": "strength",
  "profile": {
    "params": {},
    "confidence": 0.75,
    "extrapolated": true
  },
  "explanation": {
    "base_profile_id": "uuid",
    "base_profile_name": "…",
    "slicer": "orcaslicer",
    "source_name": "OrcaSlicer",
    "source_url": null,
    "source_ref": "…",
    "license": "AGPL-3.0-or-later",
    "overlay_profile_ids": ["uuid"],
    "changed_fields": [{ "field": "print_speed_mm_s", "value": 150, "reason": "… по-русски" }]
  },
  "disclaimer": "…"
}
```

Движок сначала выбирает детерминированный базовый профиль по классу сопла, кинематике, объёму и термо-паспорту; затем мёржит цепочку `inherits_id`, дельту материала и дельту intent. При отсутствии точного совпадения выбирается ближайший профиль того же класса, `extrapolated=true`, а `confidence` понижается. Температуры, печатные/транспортные скорости и скорости стенок не могут превышать паспорт принтера; каждое изменение фиксируется в `changed_fields` с русской причиной.

## Ошибки

- `401 unauthorized` — нет сессии.
- `404 not_found` — неверный формат UUID, неизвестный принтер/филамент или отсутствие базовых профилей; существование сущностей не различается по ошибке.
- `422 invalid_intent` — неизвестный intent.
- `429 RATE_LIMITED` — превышен троттлинг массовой выгрузки.
