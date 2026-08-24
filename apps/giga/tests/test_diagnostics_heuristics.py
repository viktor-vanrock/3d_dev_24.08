"""Тесты keyword-матчинга описания на каталог дефектов (MF-360, заглушка до MF-361/362)."""

from __future__ import annotations

from giga.diagnostics.heuristics import MAX_MATCHES, match_defects


def test_empty_description_returns_no_matches():
    assert match_defects("") == []
    assert match_defects("   ") == []


def test_matches_stringing_by_keywords():
    result = match_defects("между деталями тонкие нити паутина стрингинг")
    assert result
    assert result[0].id == "stringing"


def test_matches_warping_by_keywords():
    result = match_defects("углы детали приподнимаются и отрываются от стола")
    assert result
    assert result[0].id == "warping"


def test_no_overlap_returns_no_matches():
    assert match_defects("совершенно не связанный текст про котиков") == []


def test_matches_capped_at_max_matches():
    # Общие слова вроде "печать"/"деталь" пересекаются со многими дефектами.
    result = match_defects("деталь пластик слой печать поверхность стол сопло")
    assert len(result) <= MAX_MATCHES
