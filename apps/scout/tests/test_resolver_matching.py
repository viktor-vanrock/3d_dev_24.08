from __future__ import annotations

from scout.resolver.matching import MachineRow, best_match, name_similarity, plausibility_score


def test_name_similarity_exact_after_normalization_is_one():
    assert name_similarity("Creality Ender-3 V2", "Creality Ender-3 V2") == 1.0
    assert name_similarity("Original Prusa MK4S 3D Printer", "Prusa MK4S") == 1.0


def test_name_similarity_sibling_models_stay_below_exact():
    """Реальные dev-данные (2026-07-09): у этих пар разные станки, не опечатка/
    переформулировка — не должны давать 1.0 (см. `resolver/decide.py` докстринг
    про поднятый порог авто-merge)."""
    assert name_similarity("Creality Ender-3 V3", "Creality Ender-3 V3 KE") < 1.0
    assert name_similarity("Creality Ender-5S", "Creality Ender-5 S1") < 1.0


def test_name_similarity_unrelated_models_stay_low():
    assert name_similarity("Anycubic Kobra", "Creality Ender-3 V2") < 0.6


def test_name_similarity_empty_is_zero():
    assert name_similarity("", "Creality Ender-3 V2") == 0.0


def test_best_match_picks_highest_scoring_machine_and_checks_aliases():
    machines = [
        MachineRow(id="m1", model="Creality Ender-3", aliases=[]),
        MachineRow(id="m2", model="Creality Ender-3 V2", aliases=["Ender 3 V2"]),
    ]
    machine, score = best_match("Creality Ender-3 V2", machines)
    assert machine.id == "m2"
    assert score == 1.0


def test_best_match_empty_block_is_none():
    assert best_match("Creality Ender-3 V2", []) is None


def test_plausibility_score_zero_without_vendor():
    specs = {"build_volume": {"x": 200, "y": 200, "z": 200}}
    assert plausibility_score(None, "Some Printer", specs) == 0.0


def test_plausibility_score_high_for_well_formed_candidate():
    specs = {
        "build_volume": {"x": 220, "y": 220, "z": 250},
        "nozzle_diameters": [0.4],
        "machine_tech": "FFF",
    }
    score = plausibility_score("creality", "Creality Ender-3 V4", specs)
    assert score >= 0.9


def test_plausibility_score_build_volume_alone_still_clears_insert_bar():
    """Реальный dev-кандидат `101Hero` (cura-definitions: только build_volume,
    без nozzle/technology, однословное имя) — тот же барьер, что уже
    одобрен для `import-machines-bootstrap.ts::isPlausible` (см. docstring)."""
    specs = {"build_volume": {"x": 149.86, "y": 149.86, "z": 99.822, "shape": "rectangular"}}
    assert plausibility_score("101hero", "101Hero", specs) >= 0.9


def test_plausibility_score_low_without_specs():
    score = plausibility_score("prusa-research", "Original Prusa MK4S 3D Printer", {})
    assert score < 0.6
