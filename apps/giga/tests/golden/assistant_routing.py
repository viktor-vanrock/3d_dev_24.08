"""Golden-набор сценариев маршрутизации ассистента (MF-2000).

СИНТЕТИЧЕСКИЕ фикстуры — у этого агента нет `DATABASE_URL`/`HYPERPC_STRUCTURED_URL`
в этой сессии ("живём без ключа", тот же принцип, что `tests/golden/
slicer_ai_scoring.py`), но представительные для реальных RU maker-запросов
каталога (дракон/подставка/брелок — частые категории 3D-печати). Когда
доступ к реальному HYPERPC/каталогу появится — следующий шаг: прогнать те же
сценарии живьём (`test_assistant_routing_eval.test_golden_routing_scenarios_live`
уже это делает при заданном `HYPERPC_STRUCTURED_URL`), сохранив формат ниже.
"""

from __future__ import annotations

from typing import Any

from giga.assistant.evidence import Evidence

ROUTING_SCENARIOS: list[dict[str, Any]] = [
    {
        "name": "answer-with-real-citations",
        "message": "хочу дракона на стол",
        "evidence": [
            Evidence(
                model_id="model-dragon-1",
                title="Дракон для стола",
                snippet="статуэтка дракона, 15см",
                score=0.82,
            ),
            Evidence(
                model_id="model-dragon-2",
                title="Дракончик брелок",
                snippet="маленький брелок-дракон",
                score=0.4,
            ),
        ],
        "scripted_response": (
            '{"kind": "answer", "text": "Нашлась подходящая модель дракона для стола.", '
            '"citation_ids": ["model-dragon-1"]}'
        ),
        "expected_kind": "answer",
        "expected_citation_ids": ["model-dragon-1"],
    },
    {
        "name": "clarification-ambiguous-request",
        "message": "нужна подставка",
        "evidence": [
            Evidence(
                model_id="model-stand-1",
                title="Подставка под телефон",
                snippet="универсальная подставка",
                score=0.6,
            ),
        ],
        "scripted_response": (
            '{"kind": "clarification", '
            '"question": "Подставка под какое устройство — телефон или планшет?", '
            '"reason": "запрос слишком общий"}'
        ),
        "expected_kind": "clarification",
    },
    {
        "name": "generation-offer-no-catalog-match",
        "message": "сделай мне подставку под мой редкий принтер X",
        "evidence": [],
        "scripted_response": (
            '{"kind": "generation_offer", "branch": "openscad", '
            '"prompt_summary": "параметрическая подставка под конкретный принтер"}'
        ),
        "expected_kind": "generation_offer",
    },
    {
        "name": "honest-no-match-does-not-fabricate-citation",
        "message": "нужен уникальный неоновый дракон-русалка",
        "evidence": [
            Evidence(
                model_id="model-dragon-1",
                title="Дракон для стола",
                snippet="статуэтка дракона",
                score=0.2,
            ),
        ],
        "scripted_response": (
            '{"kind": "answer", '
            '"text": "Точного совпадения не нашлось, ближайшее — обычный дракон.", '
            '"citation_ids": []}'
        ),
        "expected_kind": "answer",
        "expected_citation_ids": [],
    },
    {
        "name": "malformed-model-output-degrades-to-invalid-output",
        "message": "расскажи анекдот",
        "evidence": [],
        "scripted_response": "извините, не могу ответить на это",
        "expected_kind": "error",
        "expected_error_code": "invalid_output",
    },
]
