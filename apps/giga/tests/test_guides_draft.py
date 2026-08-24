"""Тесты LLM-черновика гайда сборки — GigaChat замокан (см. `giga.
gigachat_client`, зона-принцип «без ключа живём», паттерн —
`test_catalog_extract.py`).
"""

from __future__ import annotations

import pytest
from golden.build_guide_draft import CASES

from giga import gigachat_client
from giga.guides.draft import DraftError, draft_build_steps

_INSTRUCTIONS = "1. Prep the frame. 2. Mount the motors."


@pytest.mark.parametrize("case", CASES, ids=[c.name for c in CASES])
def test_golden_set_accepted_steps_match_expected(monkeypatch, case):
    monkeypatch.setattr(
        gigachat_client, "ask_text", lambda client, system, user: case.model_response
    )

    steps = draft_build_steps(object(), case.instructions_text)

    assert [step.title for step in steps] == case.expected_titles
    assert len(steps) >= case.expected_min_steps


def test_draft_provider_failure_raises_draft_error(monkeypatch):
    def _boom(client, system, user):
        raise RuntimeError("provider unreachable")

    monkeypatch.setattr(gigachat_client, "ask_text", _boom)

    with pytest.raises(DraftError, match="provider unreachable"):
        draft_build_steps(object(), _INSTRUCTIONS)


def test_draft_unparseable_response_raises_draft_error(monkeypatch):
    monkeypatch.setattr(gigachat_client, "ask_text", lambda client, system, user: "not json at all")

    with pytest.raises(DraftError, match="неразбираемый JSON"):
        draft_build_steps(object(), _INSTRUCTIONS)


def test_draft_parses_json_without_code_fence(monkeypatch):
    monkeypatch.setattr(
        gigachat_client,
        "ask_text",
        lambda client, system, user: '{"steps": [{"title": "Шаг", "body": "", "parts": []}]}',
    )

    steps = draft_build_steps(object(), _INSTRUCTIONS)

    assert [step.title for step in steps] == ["Шаг"]


def test_draft_drops_steps_without_title(monkeypatch):
    monkeypatch.setattr(
        gigachat_client,
        "ask_text",
        lambda client, system, user: (
            '```json\n{"steps": ['
            '{"title": "Валидный шаг", "body": "b", "parts": ["винт M3"]},'
            '{"title": "", "body": "пустой заголовок", "parts": []},'
            '{"body": "нет заголовка вовсе", "parts": []}'
            "]}\n```"
        ),
    )

    steps = draft_build_steps(object(), _INSTRUCTIONS)

    assert [step.title for step in steps] == ["Валидный шаг"]
    assert steps[0].parts == ["винт M3"]


def test_draft_non_dict_steps_field_raises_draft_error(monkeypatch):
    monkeypatch.setattr(
        gigachat_client, "ask_text", lambda client, system, user: '{"steps": "not a list"}'
    )

    with pytest.raises(DraftError, match="steps не список"):
        draft_build_steps(object(), _INSTRUCTIONS)


def test_draft_truncates_long_instructions_before_sending(monkeypatch):
    captured: dict[str, str] = {}

    def _capture(client, system, user):
        captured["user"] = user
        return '{"steps": []}'

    monkeypatch.setattr(gigachat_client, "ask_text", _capture)

    draft_build_steps(object(), "x" * 50_000)

    assert len(captured["user"]) == 20_000
