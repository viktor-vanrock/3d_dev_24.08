"""Eval MF-1941: A/B "чистый MF-412-профиль" vs "MF-412 + AI-дельта" на
golden-наборе связок (`tests/golden/slicer_ai_scoring.py`), метрика —
экспертная эвристика правдоподобия (обоснование метрики — докстринг
`golden/slicer_ai_scoring.py`, "почему не реальная метрика на калибровках").

Два режима — тот же паттерн, что `test_embed_quality_eval.py`/
`test_search_quality_eval.py` (правило зоны AI: eval — часть тестов, гоняется
до передачи в QA):

- `test_ab_comparison_on_golden_set` — гоняется всегда, без `GIGACHAT_CREDENTIALS`.
  AI-слой здесь управляется скриптованным фейковым GigaChat-клиентом
  (заготовленные, экспертно-правдоподобные JSON-ответы на каждое комбо) — это
  НЕ прогон реальной модели, а регрессионный якорь на код `delta.py`/
  `matcher_port.py` (парсинг/санитизация/клэмпинг/скоринг), плюс живая
  демонстрация формата A/B-сравнения для будущего реального прогона.
- `test_real_gigachat_ab_comparison_on_golden_set` — пропускается (`skipif`),
  если `GIGACHAT_CREDENTIALS` не задан. На VDS/окружении с реальными кредами
  прогоняется по-настоящему на этом же golden-наборе.

Связки golden-набора — СИНТЕТИЧЕСКИЕ фикстуры, представительные для реального
корпуса `slicer_profiles` (см. докстринг `golden/slicer_ai_scoring.py`), не
живой прогон против `dev`-БД — в этой сессии нет `DATABASE_URL`/доступа к
дев-Postgres ("живём без ключа", `docs/architecture/readme.md`). Честно
зафиксировано как ограничение этого прогона, не выдаётся за проверку на
реальных id.
"""

from __future__ import annotations

import json
import os

import pytest
from golden.slicer_ai_scoring import GOLDEN_COMBOS, score_plausibility

from giga import gigachat_client
from giga.slicer_ai.delta import build_ai_delta
from giga.slicer_ai.matcher_port import recommend_profile

# Заготовленные, экспертно-правдоподобные ответы на каждое golden-комбо —
# небольшие, обоснованные дельты в пределах диапазонов `_PLAUSIBLE_RANGES`
# (см. `golden/slicer_ai_scoring.py`), как ожидалось бы от реальной модели,
# следующей system-промпту `slicer_ai/prompts/delta.system.md`.
_SCRIPTED_RESPONSES = {
    "creality-ender3v2-pla-exact": json.dumps(
        {
            "deltas": {"flow_ratio": 0.98, "retraction_length_mm": 0.6},
            "reasoning": {
                "flow_ratio": (
                    "Generic PLA на Creality печатается чуть плотнее номинала — "
                    "небольшое снижение потока уменьшает сочение углов."
                ),
                "retraction_length_mm": (
                    "Bowden-класс Ender-3 обычно требует чуть меньшего ретракта, "
                    "чем direct drive default."
                ),
            },
            "confidence": 0.55,
        },
        ensure_ascii=False,
    ),
    "corexy-petg-exact-speed-intent": json.dumps(
        {
            "deltas": {"cooling_fan_speed_pct": {"min": 20, "max": 40}},
            "reasoning": {
                "cooling_fan_speed_pct": (
                    "Intent «скорость» для PETG — снизить обдув, чтобы не терять "
                    "межслойную адгезию на высокой скорости."
                ),
            },
            "confidence": 0.5,
        },
        ensure_ascii=False,
    ),
    "ru-picaso-abs-extrapolated": json.dumps(
        {
            # Базовый профиль уже экстраполирован (confidence=0.40) — AI-слой
            # намеренно ничего не меняет: предлагать дельту поверх и так
            # неточного базового профиля означало бы наслаивать догадку на
            # догадку (запрещено принципом "не выдавать экстраполяцию за
            # проверенный факт").
            "deltas": {},
            "reasoning": {},
            "confidence": 0.0,
        },
        ensure_ascii=False,
    ),
}


class _Message:
    def __init__(self, content: str):
        self.content = content


class _Choice:
    def __init__(self, content: str):
        self.message = _Message(content)


class _Completion:
    def __init__(self, content: str):
        self.choices = [_Choice(content)]


class _ScriptedClient:
    def __init__(self, response: str):
        self._response = response

    def chat(self, chat):
        return _Completion(self._response)


def _run_combo(combo: dict, client) -> None:
    base = recommend_profile(
        combo["printer"],
        combo["filament"],
        combo["base_profiles"],
        combo["filament_profiles"],
        combo["intent"],
    )
    ai = build_ai_delta(client, base.params, combo["printer"], combo["filament"], combo["intent"])
    score, notes = score_plausibility(ai.changed_fields, ai.params)

    print(
        f"\nMF-1941 A/B «{combo['name']}»: "
        f"MF-412 confidence={base.confidence:.2f} extrapolated={base.extrapolated} | "
        f"AI changed={[c.field for c in ai.changed_fields]} confidence={ai.confidence:.2f} "
        f"plausibility={score:.2f}"
    )
    for note in notes:
        print(f"  - {note}")

    assert score == 1.0, f"«{combo['name']}»: AI-дельта вне экспертного диапазона: {notes}"
    # Safety-инвариант независим от AI: паспорт принтера не может быть
    # нарушен ни в base, ни в ai-профиле (см. clamp_to_passport в обоих слоях).
    if combo["printer"].max_nozzle_temp_c is not None:
        nozzle = ai.params.get("nozzle_temperature_c")
        if isinstance(nozzle, dict):
            for value in nozzle.values():
                assert value <= combo["printer"].max_nozzle_temp_c


def test_ab_comparison_on_golden_set():
    for combo in GOLDEN_COMBOS:
        client = _ScriptedClient(_SCRIPTED_RESPONSES[combo["name"]])
        _run_combo(combo, client)


@pytest.mark.skipif(
    not os.getenv("GIGACHAT_CREDENTIALS"),
    reason="нужны реальные GIGACHAT_CREDENTIALS — прогон на VDS/окружении с кредами",
)
def test_real_gigachat_ab_comparison_on_golden_set():
    client = gigachat_client.load_client()
    assert client is not None
    for combo in GOLDEN_COMBOS:
        _run_combo(combo, client)
