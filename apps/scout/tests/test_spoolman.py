import json
from pathlib import Path

from scout.sources.spoolman import (
    _color_field,
    _resolve_name,
    _slugify,
    build_candidates_for_block,
    build_manufacturer_candidates,
    content_hash,
)

FIXTURES = Path(__file__).parent / "fixtures"


def _load_fixture() -> dict:
    return json.loads((FIXTURES / "spoolman_sunlu.json").read_text())


def test_slugify_lowercases_and_collapses_separators():
    assert _slugify("Prusa Research") == "prusa-research"
    assert _slugify("PETG") == "petg"
    assert _slugify("") == "x"


def test_resolve_name_substitutes_color_placeholder():
    assert _resolve_name("{color_name}", "Black") == "Black"
    assert _resolve_name("Silk {color_name}", "Cream White") == "Silk Cream White"


def test_resolve_name_falls_back_to_template_without_color_name():
    assert _resolve_name("{color_name}", None) == "{color_name}"


def test_color_field_prefers_color_override_over_block_default():
    block = {"finish": "matte"}
    overridden = {"name": "Black", "finish": "glossy"}
    default = {"name": "Yellow"}

    assert _color_field(block, overridden, "finish") == "glossy"
    assert _color_field(block, default, "finish") == "matte"


class TestBuildCandidatesForBlock:
    def test_expands_diameter_by_color_cross_product(self):
        data = _load_fixture()
        block = data["filaments"][1]  # 2 diameters x 2 colors

        candidates = build_candidates_for_block("sunlu", "Sunlu", block)

        assert len(candidates) == 4
        assert len({c.external_ref for c in candidates}) == 4  # все уникальны

    def test_single_diameter_block_fields(self):
        data = _load_fixture()
        block = data["filaments"][0]

        candidates = build_candidates_for_block("sunlu", "Sunlu", block)

        assert len(candidates) == 2
        black = next(c for c in candidates if c.raw["color_name"] == "Black")
        assert black.external_ref == "spoolman:sunlu:pla:color-name:1.75:black"
        assert black.raw["manufacturer"] == "Sunlu"
        assert black.raw["material"] == "PLA+"
        assert black.raw["name"] == "Black"
        assert black.raw["diameter_mm"] == 1.75
        assert black.raw["color_hex"] == "000000"
        assert black.raw["extruder_temp"] == 210
        assert black.raw["bed_temp"] == 60
        assert black.raw["weights"] == [
            {"weight": 1000.0, "spool_weight": 130, "spool_type": "plastic"}
        ]
        assert black.source_url.endswith("filaments/sunlu.json")

        translucent = next(c for c in candidates if c.raw["color_name"] == "Transparent Green")
        assert translucent.raw["translucent"] is True

    def test_color_level_override_wins_over_block_level(self):
        data = _load_fixture()
        block = data["filaments"][1]

        candidates = build_candidates_for_block("sunlu", "Sunlu", block)

        def pick(color_name: str):
            return next(
                c
                for c in candidates
                if c.raw["color_name"] == color_name and c.raw["diameter_mm"] == 1.75
            )

        yellow = pick("Yellow")
        black = pick("Black")
        assert yellow.raw["finish"] == "matte"  # блочный дефолт
        assert black.raw["finish"] == "glossy"  # цветовое переопределение

    def test_temperature_ranges_carried_when_present(self):
        data = _load_fixture()
        block = data["filaments"][1]

        candidates = build_candidates_for_block("sunlu", "Sunlu", block)

        assert candidates[0].raw["extruder_temp"] is None
        assert candidates[0].raw["extruder_temp_range"] == [205, 270]
        assert candidates[0].raw["bed_temp_range"] == [70, 80]


def test_build_manufacturer_candidates_covers_every_block():
    data = _load_fixture()

    candidates = build_manufacturer_candidates("sunlu", data)

    assert len(candidates) == 6  # 1x2 (PLA+) + 2x2 (PETG)
    assert len({c.external_ref for c in candidates}) == 6


def test_content_hash_stable_and_sensitive_to_change():
    a = {"a": 1, "b": 2}
    b = {"b": 2, "a": 1}
    c = {"a": 1, "b": 3}

    assert content_hash(a) == content_hash(b)  # порядок ключей не важен
    assert content_hash(a) != content_hash(c)
