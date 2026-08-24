from scout.sources.slicer_print_profiles_cura import (
    build_material_candidate,
    build_quality_candidate,
    content_hash,
    normalize_filament_params,
    normalize_process_params,
    parse_fdm_material,
    parse_quality_cfg,
)

_QUALITY_GLOBAL_INI = """
[general]
definition = fdmprinter
name = Fine
version = 4

[metadata]
global_quality = True
quality_type = normal
setting_version = 27
type = quality
weight = 0

[values]
layer_height = 0.1
infill_sparse_density = 15
infill_pattern = grid
wall_line_count = 3
support_enable = True
support_pattern = zigzag
skirt_line_count = 1
brim_width = 8.0
speed_travel = =math.ceil(speed_print * 2)
"""

_QUALITY_PRINTER_SPECIFIC_INI = """
[general]
definition = some_printer
name = Standard
version = 4

[metadata]
global_quality = True
quality_type = normal
setting_version = 27
type = quality
weight = 0

[values]
layer_height = 0.2
"""

_MATERIAL_XML = """<?xml version="1.0" encoding="UTF-8"?>
<fdmmaterial xmlns="http://www.ultimaker.com/material"
             xmlns:cura="http://www.ultimaker.com/cura" version="1.3">
    <metadata>
        <name>
            <brand>FDplast</brand>
            <material>PLA</material>
            <color>Olive</color>
            <label>FD PLA Olive</label>
        </name>
        <GUID>b9865b5d-e8fe-41e6-a0ab-e34c58aa66a2</GUID>
        <version>5</version>
    </metadata>
    <properties>
        <density>1.24</density>
        <diameter>1.75</diameter>
        <weight>1000</weight>
    </properties>
    <settings>
        <setting key="print cooling">100.0</setting>
        <setting key="print temperature">215.0</setting>
        <setting key="heated bed temperature">65</setting>
        <setting key="standby temperature">150</setting>
        <machine>
            <machine_identifier manufacturer="Some" product="Printer" />
            <setting key="print temperature">230.0</setting>
        </machine>
    </settings>
</fdmmaterial>
"""

_MATERIAL_XML_NO_GUID = """<?xml version="1.0" encoding="UTF-8"?>
<fdmmaterial xmlns="http://www.ultimaker.com/material" version="1.3">
    <metadata>
        <name><brand>Broken</brand><material>PLA</material></name>
    </metadata>
</fdmmaterial>
"""


class TestNormalizeProcessParams:
    def test_extracts_known_keys_and_skips_formulas(self):
        parser = parse_quality_cfg(_QUALITY_GLOBAL_INI)
        values = dict(parser.items("values"))
        params = normalize_process_params(values)

        assert params["layer_height_mm"] == 0.1
        assert params["infill_density_pct"] == 15
        assert params["infill_pattern"] == "grid"
        assert params["wall_loops"] == 3
        assert params["support_enable"] is True
        assert params["support_type"] == "zigzag"
        assert params["skirt_loops"] == 1
        assert params["brim_width_mm"] == 8.0
        # setting_function formula (`=math.ceil(...)`) is not a literal number
        assert "travel_speed_mm_s" not in params


class TestBuildQualityCandidate:
    def test_global_generic_tier_is_kept(self):
        parser = parse_quality_cfg(_QUALITY_GLOBAL_INI)
        candidate = build_quality_candidate("normal", parser, "https://example/normal.inst.cfg")

        assert candidate is not None
        assert candidate.profile_class == "process"
        assert candidate.vendor == "fdmprinter"
        assert candidate.name == "Fine"
        assert candidate.setting_id is None
        assert candidate.external_ref == "cura:fdmprinter:process:normal"

    def test_printer_specific_file_is_skipped(self):
        parser = parse_quality_cfg(_QUALITY_PRINTER_SPECIFIC_INI)
        candidate = build_quality_candidate("some_file", parser, "https://example/some_file.inst.cfg")

        assert candidate is None


class TestFdmMaterial:
    def test_parses_identity_and_own_settings_without_machine_overrides(self):
        parsed = parse_fdm_material(_MATERIAL_XML)
        assert parsed is not None
        identity, own = parsed

        assert identity["brand"] == "FDplast"
        assert identity["material"] == "PLA"
        assert identity["guid"] == "b9865b5d-e8fe-41e6-a0ab-e34c58aa66a2"
        assert identity["label"] == "FD PLA Olive"
        # own carries the material's own top-level setting, not the
        # per-<machine> override (230.0)
        assert own["print temperature"] == "215.0"
        assert own["density"] == "1.24"
        assert own["diameter"] == "1.75"

    def test_missing_guid_is_rejected(self):
        assert parse_fdm_material(_MATERIAL_XML_NO_GUID) is None

    def test_malformed_xml_is_rejected(self):
        assert parse_fdm_material("<fdmmaterial><metadata>") is None


class TestNormalizeFilamentParams:
    def test_maps_recognised_keys_only(self):
        parsed = parse_fdm_material(_MATERIAL_XML)
        assert parsed is not None
        _, own = parsed
        params = normalize_filament_params(own)

        assert params["nozzle_temperature_c"] == {"other": 215.0}
        assert params["bed_temperature_c"] == {"other": 65}
        assert params["density_g_cm3"] == 1.24
        assert params["diameter_mm"] == 1.75
        # "print cooling"/"standby temperature" have no unified equivalent yet
        assert "cooling_fan_speed_pct" not in params


class TestBuildMaterialCandidate:
    def test_candidate_fields(self):
        parsed = parse_fdm_material(_MATERIAL_XML)
        assert parsed is not None
        identity, own = parsed
        candidate = build_material_candidate(
            identity, own, "https://example/fdplast_pla_olive.xml.fdm_material"
        )

        assert candidate.profile_class == "filament"
        assert candidate.vendor == "FDplast"
        assert candidate.name == "FD PLA Olive"
        assert candidate.setting_id == "b9865b5d-e8fe-41e6-a0ab-e34c58aa66a2"
        assert (
            candidate.external_ref
            == "cura:FDplast:filament:b9865b5d-e8fe-41e6-a0ab-e34c58aa66a2"
        )

    def test_falls_back_to_brand_material_color_when_label_missing(self):
        identity = {
            "guid": "x",
            "brand": "Generic",
            "material": "PLA",
            "color": "Generic",
            "label": "",
        }
        candidate = build_material_candidate(
            identity, {}, "https://example/generic_pla.xml.fdm_material"
        )

        assert candidate.name == "Generic PLA Generic"


def test_content_hash_stable_and_order_independent():
    a = {"b": 2, "a": 1}
    b = {"a": 1, "b": 2}
    assert content_hash(a) == content_hash(b)
