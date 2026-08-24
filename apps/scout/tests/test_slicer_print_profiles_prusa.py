from scout.sources.slicer_print_profiles_prusa import (
    build_candidate,
    content_hash,
    normalize_params,
)

_PRINT_COMMON = {
    "layer_height": "0.2",
    "first_layer_height": "0.2",
    "external_perimeter_speed": "20",
    "first_layer_speed": "20",
    "travel_speed": "180",
    "fill_density": "20%",
    "fill_pattern": "cubic",
    "perimeters": "2",
    "skirts": "1",
    "brim_width": "0",
}

_PRINT_LEAF = {
    "inherits": "*0.20mm*",
    "top_solid_layers": "4",
    "bottom_solid_layers": "3",
    "fill_density": "15%",
    "support_material": "0",
    "support_material_pattern": "rectilinear",
}

_FILAMENT_COMMON = {
    "extrusion_multiplier": "1",
    "filament_diameter": "1.75",
    "filament_density": "0",
    "filament_cost": "0",
}

_FILAMENT_PLA = {
    "inherits": "*common*",
    "bed_temperature": "60",
    "first_layer_bed_temperature": "60",
    "temperature": "210",
    "first_layer_temperature": "215",
    "filament_max_volumetric_speed": "15",
}

_FILAMENT_LEAF_MULTI_PARENT = {
    "inherits": "*0.15mm*; *soluble_support*",
    "temperature": "215",
}


class TestNormalizeProcessParams:
    def test_base_profile_extracts_own_keys(self):
        params = normalize_params("print", _PRINT_COMMON)

        assert params["layer_height_mm"] == 0.2
        assert params["first_layer_height_mm"] == 0.2
        assert params["print_speed_mm_s"] == 20
        assert params["first_layer_speed_mm_s"] == 20
        assert params["travel_speed_mm_s"] == 180
        assert params["infill_density_pct"] == 20
        assert params["infill_pattern"] == "cubic"
        assert params["wall_loops"] == 2
        assert params["skirt_loops"] == 1
        assert params["brim_width_mm"] == 0

    def test_leaf_profile_is_a_delta_without_inherited_keys(self):
        params = normalize_params("print", _PRINT_LEAF)

        assert params["top_shell_layers"] == 4
        assert params["bottom_shell_layers"] == 3
        assert params["infill_density_pct"] == 15
        assert params["support_enable"] is False
        assert params["support_type"] == "rectilinear"
        # not present in this section's own keys — must not be flattened in
        assert "layer_height_mm" not in params
        assert "travel_speed_mm_s" not in params


class TestNormalizeFilamentParams:
    def test_common_carries_shared_defaults(self):
        params = normalize_params("filament", _FILAMENT_COMMON)

        assert params["flow_ratio"] == 1.0
        assert params["diameter_mm"] == 1.75
        assert params["density_g_cm3"] == 0
        assert params["cost_per_kg"] == 0
        assert "nozzle_temperature_c" not in params

    def test_pla_delta_carries_temps(self):
        params = normalize_params("filament", _FILAMENT_PLA)

        assert params["nozzle_temperature_c"] == {"other": 210, "first_layer": 215}
        assert params["bed_temperature_c"] == {"other": 60, "first_layer": 60}
        assert params["max_volumetric_speed_mm3_s"] == 15
        # inherited from *common* via inherits_id, not flattened here
        assert "diameter_mm" not in params


class TestBuildCandidate:
    def test_leaf_process_candidate_fields(self):
        candidate = build_candidate(
            "print", "PrusaResearch", "0.20mm NORMAL", _PRINT_LEAF, "https://example/bundle.ini"
        )

        assert candidate.profile_class == "process"
        assert candidate.vendor == "PrusaResearch"
        assert candidate.name == "0.20mm NORMAL"
        assert candidate.inherits == "*0.20mm*"
        assert candidate.instantiable is True
        assert candidate.external_ref == "prusaslicer:PrusaResearch:process:0.20mm NORMAL"
        assert candidate.raw == _PRINT_LEAF

    def test_abstract_base_is_not_instantiable(self):
        candidate = build_candidate(
            "print", "PrusaResearch", "*common*", _PRINT_COMMON, "https://example/bundle.ini"
        )

        assert candidate.inherits is None
        assert candidate.instantiable is False

    def test_multi_parent_inherits_links_primary_only(self):
        candidate = build_candidate(
            "filament",
            "PrusaResearch",
            "0.15mm OPTIMAL SOLUBLE FULL",
            _FILAMENT_LEAF_MULTI_PARENT,
            "https://example/bundle.ini",
        )

        assert candidate.inherits == "*0.15mm*"


def test_content_hash_stable_and_order_independent():
    a = {"b": 2, "a": 1}
    b = {"a": 1, "b": 2}
    assert content_hash(a) == content_hash(b)
