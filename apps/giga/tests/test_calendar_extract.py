"""Тесты LLM-экстрактора календаря релизов — GigaChat замокан (см. `giga.
gigachat_client`, зона-принцип «без ключа живём», паттерн —
`test_branches_openscad.py`).
"""

from __future__ import annotations

import pytest
from golden.release_calendar_extraction import CASES

from giga import gigachat_client
from giga.calendar.extract import ExtractionError, extract_events
from giga.calendar.fetch import Article

_ARTICLE = Article(
    source_id="prusa-blog",
    vendor_slug="prusa-research",
    vendor_name="Prusa Research",
    title="Announcing the CORE Two",
    url="https://blog.prusa3d.com/core-two/",
    published_at=None,
    text="Prusa is proud to announce the CORE Two, shipping this fall.",
)


@pytest.mark.parametrize("case", CASES, ids=[c.name for c in CASES])
def test_golden_set_accepted_events_match_expected(monkeypatch, case):
    monkeypatch.setattr(
        gigachat_client, "ask_text", lambda client, system, user: case.model_response
    )

    result = extract_events(object(), case.article)

    assert sorted(e.model_name for e in result.events) == sorted(case.expected_model_names)
    for event in result.events:
        assert event.source_url == case.article.url


def test_extract_events_provider_failure_raises_extraction_error(monkeypatch):
    def _boom(client, system, user):
        raise RuntimeError("provider unreachable")

    monkeypatch.setattr(gigachat_client, "ask_text", _boom)

    with pytest.raises(ExtractionError, match="provider unreachable"):
        extract_events(object(), _ARTICLE)


def test_extract_events_unparseable_response_raises_extraction_error(monkeypatch):
    monkeypatch.setattr(gigachat_client, "ask_text", lambda client, system, user: "not json at all")

    with pytest.raises(ExtractionError, match="неразбираемый JSON"):
        extract_events(object(), _ARTICLE)


def test_extract_events_parses_json_without_code_fence(monkeypatch):
    monkeypatch.setattr(
        gigachat_client,
        "ask_text",
        lambda client, system, user: (
            '{"events": [{"model_name": "CORE Two", "status": "shipping", '
            '"announced_at": null, "preorder_at": null, "ship_at": null, "eol_at": null, '
            '"confidence": 0.9, "is_release_event": true}]}'
        ),
    )

    result = extract_events(object(), _ARTICLE)

    assert len(result.events) == 1
    assert result.events[0].model_name == "CORE Two"


def test_extract_events_rejects_low_confidence(monkeypatch):
    monkeypatch.setattr(
        gigachat_client,
        "ask_text",
        lambda client, system, user: (
            '```json\n{"events": [{"model_name": "CORE Two", "status": "shipping", '
            '"confidence": 0.3, "is_release_event": true}]}\n```'
        ),
    )

    result = extract_events(object(), _ARTICLE)

    assert result.events == []
    assert result.raw_count == 1
    assert result.rejected_count == 1


def test_extract_events_rejects_invalid_status(monkeypatch):
    monkeypatch.setattr(
        gigachat_client,
        "ask_text",
        lambda client, system, user: (
            '```json\n{"events": [{"model_name": "CORE Two", "status": "rumored", '
            '"confidence": 0.9, "is_release_event": true}]}\n```'
        ),
    )

    result = extract_events(object(), _ARTICLE)

    assert result.events == []


def test_extract_events_drops_invented_date_not_in_iso_format(monkeypatch):
    monkeypatch.setattr(
        gigachat_client,
        "ask_text",
        lambda client, system, user: (
            '```json\n{"events": [{"model_name": "CORE Two", "status": "shipping", '
            '"ship_at": "this fall", "confidence": 0.9, "is_release_event": true}]}\n```'
        ),
    )

    result = extract_events(object(), _ARTICLE)

    assert len(result.events) == 1
    assert result.events[0].ship_at is None


def test_extract_events_empty_events_list_is_not_an_error(monkeypatch):
    monkeypatch.setattr(
        gigachat_client, "ask_text", lambda client, system, user: '{"events": []}'
    )

    result = extract_events(object(), _ARTICLE)

    assert result.events == []
    assert result.raw_count == 0
