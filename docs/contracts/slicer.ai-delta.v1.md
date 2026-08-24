# Контракт AI-дельт `slicer.ai-delta.v1` (MF-1941)

## Эндпоинт

`GET /slicer-profiles/:printerId/:filamentId/ai-delta?intent=strength|speed|appearance|miniatures`

Внутренний эндпоинт `apps/giga` (без публичного порта — `docs/architecture/readme.md`). Вызывается `apps/api`, который уже прогнал auth/rate-limit на своей стороне `GET /slicer-profiles/:printerId/:filamentId` (`docs/contracts/slicer.profile-recommendation.v1.md`) — `giga` доверяет вызывающей стороне по границе сети, повторно сессию не проверяет (тот же паттерн, что остальные ручки `apps/giga`).

## Ответ `200`

```json
{
  "contract_version": "slicer.ai-delta.v1",
  "printer_id": "uuid",
  "filament_id": "uuid",
  "intent": "strength",
  "training_signal_available": true,
  "calibration_signal": {
    "sample_count": 10,
    "success_count": 8,
    "defect_count": 2,
    "success_rate": 0.8,
    "avg_flow_ratio": 0.97,
    "avg_pressure_advance": 0.045
  },
  "base": {
    "params": {},
    "confidence": 1.0,
    "extrapolated": false,
    "base_profile_id": "uuid",
    "base_profile_name": "…",
    "slicer": "orcaslicer",
    "source_name": "OrcaSlicer",
    "source_url": null,
    "source_ref": "…",
    "license": "AGPL-3.0-or-later",
    "overlay_profile_ids": ["uuid"],
    "changed_fields": [{ "field": "print_speed_mm_s", "value": 150, "reason": "… по-русски" }],
    "disclaimer": "…"
  },
  "ai": {
    "params": {},
    "confidence": 0.55,
    "changed_fields": [{ "field": "flow_ratio", "value": 0.98, "reason": "… по-русски" }],
    "note": null,
    "disclaimer": "…"
  }
}
```

`base` — детерминированный профиль MF-412 (`slicer.profile-recommendation.v1`, форма origin/`profile` объединена в один объект). `ai` — дополнительный слой: `ai.params` = `base.params` + дельты, предложенные GigaChat, уже клэмпнутые тем же `clamp_to_passport`, что и `base`. `ai.changed_fields` перечисляет ТОЛЬКО поля, которые AI-слой реально изменил (включая случаи, когда passport-клэмп урезал предложение модели — `reason` в этом случае содержит «паспорт», как и у `base`).

`ai.confidence` — самооценка модели, форсируется в `0` при пустых `deltas` (нет изменений — уверенность в изменении не имеет смысла). `ai.note` — не `null`, если AI-слой не участвовал: нет `GIGACHAT_CREDENTIALS` либо ответ модели не прошёл парсинг/валидацию (см. `giga/slicer_ai/delta.py`). В обоих случаях `ai.params == base.params`, `ai.changed_fields == []` — валидный ответ, не ошибка.

`training_signal_available` — `true`, если таблица `slicer_profile_calibrations` (MF-1940, обучающий сигнал v2) создана на этой БД. `calibration_signal` — агрегат реальных калибровок связки printer×filament (`giga/slicer_ai/db.py::fetch_calibration_summary`: count success/defect, `avg(flow_ratio)`, `avg(pressure_advance)`), передаётся моделью GigaChat в промпт и используется как приоритетный сигнал над общими принципами FDM (`slicer_ai/prompts/delta.system.md`). `null`, если `training_signal_available=false` ИЛИ у этой конкретной связки ещё нет ни одной калибровочной записи (штатно сразу после MF-1940 — записей 0) — в обоих случаях AI-слой опирается только на общие принципы, честно отражено этим полем, не скрыто.

## Ошибки

- `404` — неверный `printer_id`/`filament_id` или нет базовых `slicer_profiles`-кандидатов (тот же `NoMatchingProfileError`, что у MF-412).
- Отсутствие `GIGACHAT_CREDENTIALS` — НЕ ошибка, `200` с `ai.note` (см. выше); `base` сам по себе полезен вызывающей стороне.

## Safety

AI-дельты проходят ТУ ЖЕ функцию клэмпинга по паспорту принтера, что и детерминированный `base` (`giga/slicer_ai/matcher_port.py::clamp_to_passport` — документированный Python-порт `apps/api/src/slicerProfiles/matcher.ts::clampToPassport`, единственный источник safety-правил в `apps/giga`, см. докстринг файла). Модель может предлагать дельты только по allow-list полей (`giga/slicer_ai/delta.py::_SCALAR_FIELDS`/`_NESTED_FIELDS`) — любой другой ключ ответа модели отбрасывается до мёржа, не доходя до клэмпинга.
