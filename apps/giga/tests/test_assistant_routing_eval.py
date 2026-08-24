"""Golden eval прогон маршрутизации ассистента (MF-2000).

`test_golden_routing_scenarios_scripted` — ВСЕГДА прогоняется, скриптованный
HYPERPC-ответ (регрессионный якорь на `router._parse_response`/
`_citations_from_ids`, не живой вызов модели — тот же паттерн, что
`test_slicer_ai_eval.py`). `test_golden_routing_scenarios_live` —
пропускается без `HYPERPC_STRUCTURED_URL`, реальный прогон когда HYPERPC
доступен (VDS/оператор).
"""

from __future__ import annotations

import os

import pytest
from golden.assistant_routing import ROUTING_SCENARIOS

from giga.assistant import hyperpc_client as hp
from giga.assistant import router

_CONFIG = hp.HyperpcConfig(
    structured_url="http://hyperpc:1236",
    fast_url=None,
    timeout_seconds=5.0,
    max_retries=1,
    retry_backoff_seconds=0.0,
)


def test_golden_routing_scenarios_scripted(monkeypatch):
    passed = 0
    failures: list[tuple[str, object]] = []

    for scenario in ROUTING_SCENARIOS:
        monkeypatch.setattr(
            hp,
            "chat_structured",
            lambda *a, _response=scenario["scripted_response"], **k: _response,
        )
        result = router.route_message(_CONFIG, scenario["message"], scenario["evidence"])

        ok = result.kind == scenario["expected_kind"]
        if ok and "expected_citation_ids" in scenario:
            ok = [c.model_id for c in result.citations] == scenario["expected_citation_ids"]
        if ok and "expected_error_code" in scenario:
            ok = result.code == scenario["expected_error_code"]

        if ok:
            passed += 1
        else:
            failures.append((scenario["name"], result))

    accuracy = passed / len(ROUTING_SCENARIOS)
    assert accuracy == 1.0, f"golden routing regressions: {failures}"


@pytest.mark.skipif(
    not os.getenv("HYPERPC_STRUCTURED_URL"),
    reason="нужен живой HYPERPC (HYPERPC_STRUCTURED_URL) — на dev/CI обычно недоступен",
)
def test_golden_routing_scenarios_live():
    """Та же evidence, но LLM реально маршрутизирует, не скрипт. Не требуем
    точного совпадения `kind` (модель вправе решить иначе на живом входе) —
    только что ответ структурно валиден, не бросает исключение."""
    config = hp.load_config()
    assert config is not None
    for scenario in ROUTING_SCENARIOS:
        result = router.route_message(config, scenario["message"], scenario["evidence"])
        assert result.kind in {"answer", "clarification", "generation_offer", "error"}
