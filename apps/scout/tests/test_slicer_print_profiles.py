import json
from pathlib import Path

from scout.sources.slicer_print_profiles import (
    build_candidate,
    content_hash,
    normalize_params,
)

FIXTURES = Path(__file__).parent / "fixtures"


def _load_json(name: str) -> dict:
    return json.loads((FIXTURES / name).read_text())


class TestNormalizeProcessParams:
    def test_leaf_profile_extracts_own_keys_only(self):
        doc = _load_json("orca_process_ender3v2.json")

        params = normalize_params("process", doc)

        assert params["layer_height_mm"] == 0.12
        assert params["wall_loops"] == 3
        assert params["skirt_loops"] == 1
        assert params["support_enable"] is False
        assert params["support_type"] == "normal(auto)"
        assert params["top_shell_layers"] == 6
        assert params["first_layer_speed_mm_s"] == 15
        assert params["print_speed_mm_s"] == 25
        assert params["travel_speed_mm_s"] == 150
        assert params["infill_density_pct"] == 15
        assert params["infill_pattern"] == "crosshatch"
        # bottom_shell_layers=5 in this file overrides inherited 3 — own key present
        assert params["bottom_shell_layers"] == 5
        # first_layer_height_mm not overridden here — must NOT appear as a
        # flattened/inherited value (delta principle, not a full copy)
        assert "first_layer_height_mm" not in params

    def test_base_profile_has_no_inherits(self):
        doc = _load_json("orca_process_common.json")

        params = normalize_params("process", doc)

        assert params["first_layer_height_mm"] == 0.2
        assert params["print_speed_mm_s"] == 120
        assert params["first_layer_speed_mm_s"] == 20
        assert params["travel_speed_mm_s"] == 400
        assert params["wall_loops"] == 3


class TestNormalizeFilamentParams:
    def test_pla_base_carries_temps(self):
        doc = _load_json("orca_filament_pla_base.json")

        params = normalize_params("filament", doc)

        assert params["nozzle_temperature_c"] == {"other": 220, "first_layer": 220}
        assert params["bed_temperature_c"] == {"other": 60, "first_layer": 60}
        assert params["max_volumetric_speed_mm3_s"] == 12
        assert params["density_g_cm3"] == 1.24
        assert params["cost_per_kg"] == 20
        assert params["cooling_fan_speed_pct"] == {"min": 100, "max": 100}

    def test_generic_pla_is_a_delta_without_temps(self):
        """Generic PLA (instantiable) overrides only flow_ratio/max-volumetric —
        temps live on the fdm_filament_pla base, resolved via inherits_id chain,
        not flattened into every leaf record."""
        doc = _load_json("orca_filament_generic_pla.json")

        params = normalize_params("filament", doc)

        assert params["flow_ratio"] == 0.98
        assert params["max_volumetric_speed_mm3_s"] == 12
        assert "nozzle_temperature_c" not in params
        assert "bed_temperature_c" not in params

    def test_petg_and_abs_bases_have_distinct_temps(self):
        petg = normalize_params("filament", _load_json("orca_filament_pet_base.json"))
        abs_ = normalize_params("filament", _load_json("orca_filament_abs_base.json"))

        assert petg["nozzle_temperature_c"]["other"] == 255
        assert petg["bed_temperature_c"]["other"] == 80
        assert abs_["nozzle_temperature_c"]["other"] == 260
        assert abs_["bed_temperature_c"]["other"] == 105

    def test_nil_and_missing_values_are_dropped(self):
        doc = _load_json("orca_filament_common.json")

        params = normalize_params("filament", doc)

        assert "retraction_length_mm" not in params
        assert "retraction_speed_mm_s" not in params
        assert "z_hop_mm" not in params
        assert params["diameter_mm"] == 1.75
        assert params["flow_ratio"] == 1.0


class TestBuildCandidate:
    def test_leaf_process_candidate_fields(self):
        doc = _load_json("orca_process_ender3v2.json")

        candidate = build_candidate("process", "Creality", "irrelevant", doc, "https://example/process.json")

        assert candidate.profile_class == "process"
        assert candidate.vendor == "Creality"
        assert candidate.name == "0.12mm Fine @Creality Ender3V2"
        assert candidate.setting_id == "BYotUlZcqUXYiUJD"
        assert candidate.inherits == "fdm_process_creality_common"
        assert candidate.instantiable is True
        assert (
            candidate.external_ref
            == "orcaslicer:Creality:process:0.12mm Fine @Creality Ender3V2"
        )
        assert candidate.raw == doc

    def test_base_profile_setting_id_is_none_and_not_instantiable(self):
        doc = _load_json("orca_process_common.json")

        candidate = build_candidate("process", "Creality", "fdm_process_common", doc, "https://example/base.json")

        assert candidate.setting_id is None
        assert candidate.inherits is None
        assert candidate.instantiable is False


def test_content_hash_stable_and_order_independent():
    a = {"b": 2, "a": 1}
    b = {"a": 1, "b": 2}
    assert content_hash(a) == content_hash(b)
