"""Тесты LLM-экстрактора каталога станков — GigaChat замокан (см. `giga.
gigachat_client`, зона-принцип «без ключа живём», паттерн —
`test_calendar_extract.py`).
"""

from __future__ import annotations

import pytest
from golden.machine_candidate_extraction import CASES

from giga import gigachat_client
from giga.calendar.fetch import Article
from giga.catalog.extract import ExtractionError, extract_machine_candidates

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
def test_golden_set_accepted_machines_match_expected(monkeypatch, case):
    monkeypatch.setattr(
        gigachat_client, "ask_text", lambda client, system, user: case.model_response
    )

    result = extract_machine_candidates(object(), case.article)

    assert sorted((m.vendor, m.model) for m in result.machines) == sorted(case.expected)
    for machine in result.machines:
        assert machine.source_url == case.article.url


def test_extract_provider_failure_raises_extraction_error(monkeypatch):
    def _boom(client, system, user):
        raise RuntimeError("provider unreachable")

    monkeypatch.setattr(gigachat_client, "ask_text", _boom)

    with pytest.raises(ExtractionError, match="provider unreachable"):
        extract_machine_candidates(object(), _ARTICLE)


def test_extract_unparseable_response_raises_extraction_error(monkeypatch):
    monkeypatch.setattr(gigachat_client, "ask_text", lambda client, system, user: "not json at all")

    with pytest.raises(ExtractionError, match="неразбираемый JSON"):
        extract_machine_candidates(object(), _ARTICLE)


def test_extract_parses_json_without_code_fence(monkeypatch):
    monkeypatch.setattr(
        gigachat_client,
        "ask_text",
        lambda client, system, user: (
            '{"is_machine_page": true, "machines": [{"vendor": "Prusa Research", '
            '"model": "CORE Two", "specs": {}, "confidence": 0.9}]}'
        ),
    )

    result = extract_machine_candidates(object(), _ARTICLE)

    assert len(result.machines) == 1
    assert result.machines[0].model == "CORE Two"


def test_extract_rejects_low_confidence(monkeypatch):
    monkeypatch.setattr(
        gigachat_client,
        "ask_text",
        lambda client, system, user: (
            '```json\n{"is_machine_page": true, "machines": [{"vendor": "Prusa Research", '
            '"model": "CORE Two", "specs": {}, "confidence": 0.3}]}\n```'
        ),
    )

    result = extract_machine_candidates(object(), _ARTICLE)

    assert result.machines == []
    assert result.raw_count == 1
    assert result.rejected_count == 1


def test_extract_rejects_missing_vendor_or_model(monkeypatch):
    monkeypatch.setattr(
        gigachat_client,
        "ask_text",
        lambda client, system, user: (
            '```json\n{"is_machine_page": true, "machines": [{"vendor": "", '
            '"model": "CORE Two", "specs": {}, "confidence": 0.9}]}\n```'
        ),
    )

    result = extract_machine_candidates(object(), _ARTICLE)

    assert result.machines == []


def test_extract_is_machine_page_false_short_circuits_even_with_machines(monkeypatch):
    monkeypatch.setattr(
        gigachat_client,
        "ask_text",
        lambda client, system, user: (
            '```json\n{"is_machine_page": false, "machines": [{"vendor": "Prusa Research", '
            '"model": "CORE Two", "specs": {}, "confidence": 0.9}]}\n```'
        ),
    )

    result = extract_machine_candidates(object(), _ARTICLE)

    assert result.machines == []
    assert result.raw_count == 0


def test_extract_drops_implausible_build_volume_but_keeps_candidate(monkeypatch):
    monkeypatch.setattr(
        gigachat_client,
        "ask_text",
        lambda client, system, user: (
            '```json\n{"is_machine_page": true, "machines": [{"vendor": "Prusa Research", '
            '"model": "CORE Two", "specs": {"build_volume": {"x": 250, "y": 220, "z": 99999}, '
            '"max_nozzle_temp_c": 300}, "confidence": 0.9}]}\n```'
        ),
    )

    result = extract_machine_candidates(object(), _ARTICLE)

    assert len(result.machines) == 1
    specs = result.machines[0].specs
    assert "build_volume" not in specs
    assert specs["max_nozzle_temp_c"] == 300


def test_extract_drops_implausible_temperature(monkeypatch):
    monkeypatch.setattr(
        gigachat_client,
        "ask_text",
        lambda client, system, user: (
            '```json\n{"is_machine_page": true, "machines": [{"vendor": "Prusa Research", '
            '"model": "CORE Two", "specs": {"max_bed_temp_c": 5000}, "confidence": 0.9}]}\n```'
        ),
    )

    result = extract_machine_candidates(object(), _ARTICLE)

    assert len(result.machines) == 1
    assert result.machines[0].specs == {}


def test_extract_empty_machines_list_is_not_an_error(monkeypatch):
    monkeypatch.setattr(
        gigachat_client,
        "ask_text",
        lambda client, system, user: '{"is_machine_page": false, "machines": []}',
    )

    result = extract_machine_candidates(object(), _ARTICLE)

    assert result.machines == []
    assert result.raw_count == 0
