from __future__ import annotations

from scout.resolver.decide import decide


def test_exact_dup_auto_merges_as_update():
    decision = decide(1.0, "machine-1", 0.5)
    assert decision.action == "update"
    assert decision.matched_machine_id == "machine-1"
    assert decision.confidence == 1.0


def test_ambiguous_dup_goes_to_matched_review():
    decision = decide(0.85, "machine-1", 0.2)
    assert decision.action == "matched"
    assert decision.matched_machine_id == "machine-1"
    assert decision.confidence == 0.85


def test_review_floor_is_inclusive():
    decision = decide(0.6, "machine-1", 0.0)
    assert decision.action == "matched"


def test_no_dup_but_plausible_inserts_as_new():
    decision = decide(0.2, None, 0.95)
    assert decision.action == "insert"
    assert decision.matched_machine_id is None
    assert decision.confidence == 0.95


def test_no_dup_and_not_plausible_is_rejected():
    decision = decide(0.0, None, 0.4)
    assert decision.action == "rejected"
    assert decision.matched_machine_id is None


def test_weak_dup_below_review_floor_falls_back_to_plausibility():
    """dup_score < 0.6 (нет реального совпадения в блоке вендора) — решение
    целиком по плаузибилити кандидата, matched_machine_id от dup игнорируется."""
    decision = decide(0.3, "machine-1", 0.95)
    assert decision.action == "insert"
    assert decision.matched_machine_id is None
