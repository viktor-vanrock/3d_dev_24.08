import json
from pathlib import Path

import pytest

from scout.sources.slicer_profiles import (
    RU_PRINTERS,
    RU_SOURCE_ID,
    SOURCE_ID,
    _pick_latest_bundle_version,
    _resolve_prusa_printer,
    _split_semicolon,
    build_orca_candidate,
    build_prusa_candidate,
    build_ru_printer_candidate,
    content_hash,
    fetch_ru_printer_candidates,
    parse_prusa_bundle,
)

FIXTURES = Path(__file__).parent / "fixtures"


def _load_json(name: str) -> dict:
    return json.loads((FIXTURES / name).read_text())


def test_split_semicolon_trims_and_drops_empty():
    assert _split_semicolon("a; b ;; c") == ["a", "b", "c"]
    assert _split_semicolon("") == []
    assert _split_semicolon(None) == []


class TestOrcaCandidate:
    def test_full_variant_fills_build_volume(self):
        vendor_index = _load_json("orca_vendor_creality.json")
        model_entry = vendor_index["machine_model_list"][0]
        model_json = _load_json("orca_model_ender3v2.json")
        variant_json = _load_json("orca_variant_ender3v2_04.json")

        candidate = build_orca_candidate("Creality", model_entry, model_json, variant_json)

        assert candidate.external_ref == "orca:Creality:Creality_Ender_3_V2"
        assert candidate.raw["vendor"] == "Creality"
        assert candidate.raw["model"] == "Creality Ender-3 V2"
        assert candidate.raw["nozzle_diameter_mm"] == ["0.4"]
        assert candidate.raw["default_materials"] == [
            "Creality Generic PLA",
            "Creality Generic PETG",
            "Creality Generic ABS",
        ]
        assert candidate.raw["printable_area"] == ["0x0", "220x0", "220x220", "0x220"]
        assert candidate.raw["printable_height"] == "250"

    def test_missing_variant_omits_build_volume_but_stays_valid(self):
        vendor_index = _load_json("orca_vendor_creality.json")
        model_entry = vendor_index["machine_model_list"][0]
        model_json = _load_json("orca_model_ender3v2.json")

        candidate = build_orca_candidate("Creality", model_entry, model_json, None)

        assert candidate.external_ref == "orca:Creality:Creality_Ender_3_V2"
        assert "printable_area" not in candidate.raw
        assert candidate.raw["model"] == "Creality Ender-3 V2"

    def test_falls_back_to_model_name_without_model_id(self):
        model_entry = {"name": "Weird Printer", "sub_path": "machine/Weird Printer.json"}
        model_json = {"type": "machine_model", "machine_tech": "FFF"}

        candidate = build_orca_candidate("Weird", model_entry, model_json, None)

        assert candidate.external_ref == "orca:Weird:Weird Printer"


class TestPrusaBundle:
    def _parser(self):
        ini_text = (FIXTURES / "prusa_bundle_sample.ini").read_text()
        return parse_prusa_bundle(ini_text)

    def test_inherits_chain_merges_common_with_override(self):
        parser = self._parser()

        mk3 = _resolve_prusa_printer(parser, "printer:Original Prusa i3 MK3")
        assert mk3["bed_shape"] == "0x0,250x0,250x210,0x210"  # inherited from *common*
        assert mk3["max_print_height"] == "210"  # own override
        assert mk3["gcode_flavor"] == "marlin"  # inherited, untouched

        mk4 = _resolve_prusa_printer(parser, "printer:Original Prusa MK4")
        assert mk4["bed_shape"] == "0x0,250x0,250x220,0x220"  # own override wins over *common*
        assert mk4["max_print_height"] == "220"

    def test_build_prusa_candidate_from_sections(self):
        parser = self._parser()
        model_section = dict(parser.items("printer_model:MK3"))
        merged = _resolve_prusa_printer(parser, "printer:Original Prusa i3 MK3")

        candidate = build_prusa_candidate(
            "PrusaResearch", "MK3", model_section, merged, "1.14.2.ini"
        )

        assert candidate.external_ref == "prusa:PrusaResearch:MK3"
        assert candidate.raw["model"] == "Original Prusa i3 MK3"
        assert candidate.raw["nozzle_diameter_mm"] == ["0.4", "0.25", "0.6", "0.8"]
        assert candidate.raw["bed_shape"] == "0x0,250x0,250x210,0x210"
        assert candidate.raw["max_print_height"] == "210"
        assert candidate.raw["bundle_version"] == "1.14.2.ini"

    def test_unknown_section_resolves_empty(self):
        parser = self._parser()
        assert _resolve_prusa_printer(parser, "printer:Does Not Exist") == {}


@pytest.mark.parametrize(
    ("filenames", "expected"),
    [
        (["1.2.0.ini", "1.10.0.ini", "1.9.5.ini"], "1.10.0.ini"),
        (["1.2.0.ini", "2.0.0-alpha.ini", "1.9.5.ini"], "1.9.5.ini"),
        (["not-a-version.ini"], None),
        ([], None),
    ],
)
def test_pick_latest_bundle_version(filenames, expected):
    assert _pick_latest_bundle_version(filenames) == expected


class TestRuPrinters:
    def test_ru_source_id_distinct_from_slicer_profile(self):
        assert RU_SOURCE_ID == "ru_machine_spec"
        assert RU_SOURCE_ID != SOURCE_ID

    def test_external_refs_unique(self):
        refs = [f"ru:{spec.vendor_slug}:{spec.model_slug}" for spec in RU_PRINTERS]
        assert len(refs) == len(set(refs))

    def test_every_spec_has_source_url_and_incomplete_fields(self):
        for spec in RU_PRINTERS:
            assert spec.source_url.startswith("https://")
            assert spec.incomplete_fields  # честно неполные паспортные данные

    def test_build_candidate_fills_specs_build_volume(self):
        spec = RU_PRINTERS[0]
        candidate = build_ru_printer_candidate(spec)

        assert candidate.external_ref == f"ru:{spec.vendor_slug}:{spec.model_slug}"
        assert candidate.source_url == spec.source_url
        assert candidate.raw["vendor"] == spec.vendor
        assert candidate.raw["model"] == spec.model
        x, y, z = spec.build_volume_mm
        assert candidate.raw["specs"]["build_volume"] == {
            "x": x, "y": y, "z": z, "shape": "rectangular",
        }
        assert candidate.raw["incomplete_fields"] == list(spec.incomplete_fields)
        assert "OrcaSlicer" in candidate.raw["provenance_note"]

    def test_build_candidate_omits_unset_optional_fields(self):
        totalz = next(s for s in RU_PRINTERS if s.vendor_slug == "total-z")
        candidate = build_ru_printer_candidate(totalz)

        assert candidate.raw["filament_diameter_mm"] == list(totalz.filament_diameter_mm)
        assert "chamber_temp_max_c" not in candidate.raw  # Total Z не публикует это поле

    def test_fetch_ru_printer_candidates_covers_all_specs(self):
        candidates = fetch_ru_printer_candidates()
        assert len(candidates) == len(RU_PRINTERS)
        assert {c.external_ref for c in candidates} == {
            f"ru:{spec.vendor_slug}:{spec.model_slug}" for spec in RU_PRINTERS
        }


def test_content_hash_stable_and_sensitive_to_change():
    a = {"a": 1, "b": 2}
    b = {"b": 2, "a": 1}
    c = {"a": 1, "b": 3}

    assert content_hash(a) == content_hash(b)  # key order doesn't matter
    assert content_hash(a) != content_hash(c)
