"""Тесты AI-обогащения подачи идеи — GigaChat замокан (паттерн `test_guides_draft.py`)."""

from __future__ import annotations

import json

import pytest

from giga import gigachat_client
from giga.ideas.enrich import EnrichError, enrich_idea_draft

_FREE_TEXT = "не хватает тёмной темы на странице каталога"


def test_enrich_parses_json_in_code_fence(monkeypatch):
    monkeypatch.setattr(
        gigachat_client,
        "ask_text",
        lambda client, system, user: (
            '```json\n{"title": "Тёмная тема каталога", '
            '"body": "Добавить тёмную тему.", "category": "catalog"}\n```'
        ),
    )

    draft = enrich_idea_draft(object(), _FREE_TEXT)

    assert draft.title == "Тёмная тема каталога"
    assert draft.body == "Добавить тёмную тему."
    assert draft.category == "catalog"


def test_enrich_parses_json_without_code_fence(monkeypatch):
    monkeypatch.setattr(
        gigachat_client,
        "ask_text",
        lambda client, system, user: '{"title": "Идея", "body": "", "category": "other"}',
    )

    draft = enrich_idea_draft(object(), _FREE_TEXT)

    assert draft.title == "Идея"
    assert draft.category == "other"


def test_enrich_provider_failure_raises_enrich_error(monkeypatch):
    def _boom(client, system, user):
        raise RuntimeError("provider unreachable")

    monkeypatch.setattr(gigachat_client, "ask_text", _boom)

    with pytest.raises(EnrichError, match="provider unreachable"):
        enrich_idea_draft(object(), _FREE_TEXT)


def test_enrich_unparseable_response_raises_enrich_error(monkeypatch):
    monkeypatch.setattr(gigachat_client, "ask_text", lambda client, system, user: "not json at all")

    with pytest.raises(EnrichError, match="неразбираемый JSON"):
        enrich_idea_draft(object(), _FREE_TEXT)


def test_enrich_rejects_unknown_category(monkeypatch):
    monkeypatch.setattr(
        gigachat_client,
        "ask_text",
        lambda client, system, user: '{"title": "Идея", "body": "b", "category": "banana"}',
    )

    with pytest.raises(EnrichError, match="неизвестная категория"):
        enrich_idea_draft(object(), _FREE_TEXT)


def test_enrich_rejects_oversized_title(monkeypatch):
    long_title = "а" * 121
    payload = json.dumps({"title": long_title, "body": "", "category": "other"})
    monkeypatch.setattr(gigachat_client, "ask_text", lambda client, system, user: payload)

    with pytest.raises(EnrichError, match="длиннее 120"):
        enrich_idea_draft(object(), _FREE_TEXT)


def test_enrich_empty_title_is_not_an_error(monkeypatch):
    monkeypatch.setattr(
        gigachat_client,
        "ask_text",
        lambda client, system, user: '{"title": "", "body": "", "category": "other"}',
    )

    draft = enrich_idea_draft(object(), _FREE_TEXT)

    assert draft.title == ""
    assert draft.category == "other"


def test_enrich_truncates_long_free_text_before_sending(monkeypatch):
    captured: dict[str, str] = {}

    def _capture(client, system, user):
        captured["user"] = user
        return '{"title": "", "body": "", "category": "other"}'

    monkeypatch.setattr(gigachat_client, "ask_text", _capture)

    enrich_idea_draft(object(), "x" * 10_000)

    assert len(captured["user"]) == 4_000
