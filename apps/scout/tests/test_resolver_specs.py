from __future__ import annotations

from scout.resolver.specs import derive_kind, extract_specs, is_plausible_specs, parse_points


def test_parse_points_from_list_of_points():
    assert parse_points(["0x0", "220x0", "220x220", "0x220"]) == (220.0, 220.0)


def test_parse_points_from_csv_string():
    assert parse_points("0,0,255,0,255,207,0,207") is None  # не 'XxY' формат — не парсится


def test_parse_points_needs_at_least_two_points():
    assert parse_points(["0x0"]) is None
    assert parse_points(None) is None
    assert parse_points([]) is None


def test_extract_specs_prefers_already_structured_shape():
    raw = {
        "vendor": "Geeetech",
        "model": "Geeetech Base Multi-Extruder Printer",
        "specs": {"build_volume": {"x": 350, "y": 350, "z": 350, "shape": "rectangular"}},
    }
    specs = extract_specs(raw)
    assert specs["build_volume"] == {"x": 350.0, "y": 350.0, "z": 350.0, "shape": "rectangular"}


def test_extract_specs_from_flat_slicer_fields_printable_area():
    raw = {
        "printable_area": ["0x0", "220x0", "220x220", "0x220"],
        "printable_height": "250",
        "nozzle_diameter_mm": ["0.4", "0.6"],
        "machine_tech": "FFF",
    }
    specs = extract_specs(raw)
    assert specs["build_volume"] == {"x": 220.0, "y": 220.0, "z": 250.0, "shape": "rectangular"}
    assert specs["nozzle_diameters"] == [0.4, 0.6]
    assert specs["machine_tech"] == "FFF"


def test_extract_specs_from_flat_slicer_fields_bed_shape():
    raw = {"bed_shape": "0x0,250x0,250x210,0x210", "max_print_height": "200"}
    specs = extract_specs(raw)
    assert specs["build_volume"] == {"x": 250.0, "y": 210.0, "z": 200.0, "shape": "rectangular"}


def test_extract_specs_vendor_whitelist_shape_has_no_geometry():
    raw = {
        "vendor_name": "Prusa Research",
        "model_name": "Prusa MK4S",
        "offers": [{"price": "799"}],
    }
    assert extract_specs(raw) == {}


def test_is_plausible_specs_boundary():
    assert is_plausible_specs({"build_volume": {"x": 200, "y": 200, "z": 200}}) is True
    assert is_plausible_specs({"build_volume": {"x": 2000, "y": 200, "z": 200}}) is True
    assert is_plausible_specs({"build_volume": {"x": 2001, "y": 200, "z": 200}}) is False
    assert is_plausible_specs({"build_volume": {"x": 0, "y": 200, "z": 200}}) is False
    assert is_plausible_specs({}) is False


def test_derive_kind_defaults_to_fdm():
    assert derive_kind({}) == "fdm_printer"
    assert derive_kind({"machine_tech": "FFF"}) == "fdm_printer"


def test_derive_kind_sla_family():
    assert derive_kind({"machine_tech": "SLA"}) == "sla_printer"
    assert derive_kind({"machine_tech": "msla"}) == "sla_printer"
