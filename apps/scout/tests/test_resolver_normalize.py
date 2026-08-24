from __future__ import annotations

from scout.resolver.normalize import (
    extract_vendor_and_model,
    normalize_model_name,
    resolve_vendor,
    slugify,
)


def test_slugify_lowercases_and_hyphenates():
    assert slugify("Folger Tech") == "folger-tech"
    assert slugify("  Weird__Name!! ") == "weird-name"


def test_resolve_vendor_known_alias_bbl():
    assert resolve_vendor("BBL") == ("bambu-lab", "Bambu Lab")


def test_resolve_vendor_case_and_spacing_variants_collapse_to_one_slug():
    """Наблюдение на dev 2026-07-09: 'Sovol'/'SOVOL'/'sovol3d'/'Sovol3d'/'Sovol 3D'
    сосуществуют как сырой текст вендора в разных кандидатах — все должны
    схлопнуться в один `vendors`-слаг, иначе резолвер заведёт вендора-дублёра."""
    variants = ["Sovol", "SOVOL", "sovol3d", "Sovol3d", "Sovol 3D"]
    resolved = {resolve_vendor(v) for v in variants}
    assert resolved == {("sovol", "Sovol")}


def test_resolve_vendor_skips_generic_firmware_placeholder():
    assert resolve_vendor("Custom") is None
    assert resolve_vendor("custom") is None


def test_resolve_vendor_unknown_falls_back_to_generic_slugify():
    assert resolve_vendor("Afinia") == ("afinia", "Afinia")


def test_resolve_vendor_empty_is_none():
    assert resolve_vendor("") is None
    assert resolve_vendor(None) is None
    assert resolve_vendor("   ") is None


def test_normalize_model_name_strips_noise_words_and_punctuation():
    assert normalize_model_name("Original Prusa MK4S 3D Printer") == "prusa mk4s"
    assert normalize_model_name("Prusa MK4S") == "prusa mk4s"


def test_normalize_model_name_collapses_punctuation():
    dashed, spaced = "Creality Ender-3 V2", "Creality Ender 3 V2"
    assert normalize_model_name(dashed) == normalize_model_name(spaced)


def test_extract_vendor_and_model_slicer_profile_shape():
    raw = {"vendor": "Creality", "model": "Creality Ender-3 V2", "model_id": "x"}
    assert extract_vendor_and_model(raw) == ("Creality", "Creality Ender-3 V2")


def test_extract_vendor_and_model_vendor_whitelist_shape():
    raw = {
        "vendor_name": "Prusa Research",
        "vendor_slug": "prusa-research",
        "model_name": "Prusa MK4S",
    }
    assert extract_vendor_and_model(raw) == ("Prusa Research", "Prusa MK4S")


def test_extract_vendor_and_model_missing_keys_is_none():
    assert extract_vendor_and_model({"price": {"amount": 1}}) is None
    assert extract_vendor_and_model({"vendor": "Creality"}) is None
