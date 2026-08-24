"""Тесты каталога дефектов печати (MF-360)."""

from __future__ import annotations

from giga.diagnostics.catalog import KNOWN_MATERIALS, get_defect, load_defects


def test_catalog_has_at_least_ten_defects():
    defects = load_defects()
    assert len(defects) >= 10


def test_catalog_entries_cover_known_materials():
    defects = load_defects()
    covered = {material for defect in defects for material in defect.materials}
    assert covered <= KNOWN_MATERIALS
    assert covered  # каталог реально покрывает хотя бы часть материалов


def test_catalog_entries_have_symptoms_causes_and_recommendations():
    for defect in load_defects():
        assert defect.symptoms
        assert defect.causes
        assert defect.recommendations


def test_catalog_ids_are_unique():
    defects = load_defects()
    ids = [defect.id for defect in defects]
    assert len(ids) == len(set(ids))


def test_load_defects_is_cached():
    assert load_defects() is load_defects()


def test_get_defect_returns_none_for_unknown_id():
    assert get_defect("not-a-real-defect") is None


def test_get_defect_returns_matching_entry():
    warping = get_defect("warping")
    assert warping is not None
    assert warping.name_ru
    assert "ABS" in warping.materials


def test_recommendations_for_material_includes_specific_and_general():
    warping = get_defect("warping")
    material_recs = warping.recommendations_for("ABS")
    general_recs = warping.recommendations_for(None)
    assert set(warping.recommendations["ABS"]) <= set(material_recs)
    assert set(warping.recommendations.get("general", [])) <= set(general_recs)


def test_recommendations_for_missing_material_falls_back_to_general_only():
    warping = get_defect("warping")
    assert warping.recommendations_for("TPU") == warping.recommendations.get("general", [])
