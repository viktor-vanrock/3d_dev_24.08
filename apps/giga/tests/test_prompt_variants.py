"""Тесты вариантов промпта для главной — локальная Gemma замокана."""

from __future__ import annotations

import json

import pytest

from giga.assistant import hyperpc_client
from giga.prompt_variants.generate import PromptVariantsError, generate_prompt_variants

_QUERY = "дракон для стола"


def _stub_response(monkeypatch, payload: dict | str) -> None:
    text = payload if isinstance(payload, str) else json.dumps(payload)
    monkeypatch.setattr(
        hyperpc_client,
        "chat_fast",
        lambda config, system, user, **kwargs: text,
    )


_VALID_PAYLOAD = {
    "normalized_query": "дракон для стола",
    "motif": "дракон",
    "variants": [
        {
            "label": "Дракон-статуэтка",
            "prompt": "детализированная статуэтка дракона",
            "motif": "дракон",
            "confidence": 0.9,
        },
        {
            "label": "Дракон-подставка",
            "prompt": "дракон в виде подставки для телефона",
            "motif": "дракон",
            "confidence": 0.6,
        },
        {
            "label": "Дракон-брелок",
            "prompt": "маленький дракон-брелок",
            "motif": "дракон",
            "confidence": 0.5,
        },
        {
            "label": "Дракон-светильник",
            "prompt": "дракон-ночник с полым телом",
            "motif": "дракон",
            "confidence": 0.4,
        },
    ],
}


def test_generate_parses_json_in_code_fence(monkeypatch):
    monkeypatch.setattr(
        hyperpc_client,
        "chat_fast",
        lambda config, system, user, **kwargs: f"```json\n{json.dumps(_VALID_PAYLOAD)}\n```",
    )

    draft = generate_prompt_variants(object(), _QUERY, 6)

    assert draft.normalized_query == "дракон для стола"
    assert draft.motif == "дракон"
    assert len(draft.variants) == 4
    assert draft.variants[0].label == "Дракон-статуэтка"
    assert draft.variants[0].confidence == 0.9


def test_generate_parses_json_without_code_fence(monkeypatch):
    _stub_response(monkeypatch, _VALID_PAYLOAD)

    draft = generate_prompt_variants(object(), _QUERY, 6)

    assert draft.normalized_query == "дракон для стола"


def test_generate_respects_limit(monkeypatch):
    _stub_response(monkeypatch, _VALID_PAYLOAD)

    draft = generate_prompt_variants(object(), _QUERY, 2)

    assert len(draft.variants) == 2


def test_generate_falls_back_to_top_level_motif_when_variant_has_none(monkeypatch):
    payload = json.loads(json.dumps(_VALID_PAYLOAD))
    payload["variants"][0]["motif"] = None
    _stub_response(monkeypatch, payload)

    draft = generate_prompt_variants(object(), _QUERY, 6)

    assert draft.variants[0].motif == "дракон"


def test_generate_clamps_confidence(monkeypatch):
    payload = json.loads(json.dumps(_VALID_PAYLOAD))
    payload["variants"][0]["confidence"] = 5
    _stub_response(monkeypatch, payload)

    draft = generate_prompt_variants(object(), _QUERY, 6)

    assert draft.variants[0].confidence == 1.0


def test_generate_provider_failure_raises_error(monkeypatch):
    def _boom(config, system, user, **kwargs):
        raise RuntimeError("provider unreachable")

    monkeypatch.setattr(hyperpc_client, "chat_fast", _boom)

    with pytest.raises(PromptVariantsError, match="provider unreachable"):
        generate_prompt_variants(object(), _QUERY, 6)


def test_generate_unparseable_response_raises_error(monkeypatch):
    _stub_response(monkeypatch, "not json at all")

    with pytest.raises(PromptVariantsError, match="неразбираемый JSON"):
        generate_prompt_variants(object(), _QUERY, 6)


def test_generate_empty_normalized_query_raises_error(monkeypatch):
    payload = json.loads(json.dumps(_VALID_PAYLOAD))
    payload["normalized_query"] = ""
    _stub_response(monkeypatch, payload)

    with pytest.raises(PromptVariantsError, match="пустой normalized_query"):
        generate_prompt_variants(object(), _QUERY, 6)


def test_generate_empty_variants_raises_error(monkeypatch):
    payload = json.loads(json.dumps(_VALID_PAYLOAD))
    payload["variants"] = []
    _stub_response(monkeypatch, payload)

    with pytest.raises(PromptVariantsError, match="пустой/невалидный variants"):
        generate_prompt_variants(object(), _QUERY, 6)


def test_generate_skips_incomplete_variant_entries(monkeypatch):
    payload = json.loads(json.dumps(_VALID_PAYLOAD))
    payload["variants"].insert(0, {"label": "", "prompt": "", "motif": None, "confidence": 0.9})
    _stub_response(monkeypatch, payload)

    draft = generate_prompt_variants(object(), _QUERY, 6)

    assert all(v.label and v.prompt for v in draft.variants)
    assert len(draft.variants) == 4


def test_generate_truncates_long_query_before_sending(monkeypatch):
    captured: dict[str, str] = {}

    def _capture(config, system, user, **kwargs):
        captured["user"] = user
        return json.dumps(_VALID_PAYLOAD)

    monkeypatch.setattr(hyperpc_client, "chat_fast", _capture)

    generate_prompt_variants(object(), "x" * 10_000, 6)

    payload = json.loads(captured["user"])
    assert len(payload["query"]) == 300
    assert payload["batch"] == 0
    assert payload["exclude_labels"] == []


def test_generate_sends_batch_and_recent_exclusions_to_gemma(monkeypatch):
    captured: dict[str, object] = {}

    def _capture(config, system, user, **kwargs):
        captured["user"] = user
        captured["system"] = system
        captured["max_tokens"] = kwargs.get("max_tokens")
        captured["temperature"] = kwargs.get("temperature")
        return json.dumps(_VALID_PAYLOAD)

    monkeypatch.setattr(hyperpc_client, "chat_fast", _capture)

    generate_prompt_variants(
        object(),
        _QUERY,
        6,
        batch=7,
        exclude_labels=["Котики", "Древний Рим"],
    )

    payload = json.loads(captured["user"])
    assert payload == {
        "query": _QUERY,
        "batch": 7,
        "exclude_labels": ["Котики", "Древний Рим"],
    }
    assert captured["max_tokens"] == 2800
    assert captured["temperature"] == 1.0
    assert "Не работай как комбинатор" in str(captured["system"])
    assert "не копируй исходный запрос целиком" in str(captured["system"]).lower()
    assert "от 8 до 50 слов" in str(captured["system"])
    assert "сохранение смыслового ядра" in str(captured["system"])
    assert "держателя наушников" in str(captured["system"])
