from scout.sources.slicer_print_profiles_ru import (
    RU_MATERIALS,
    RU_VENDORS,
    build_candidate,
    build_extrapolation_reason,
    content_hash,
    external_ref,
)

_BASE_PLA_PARAMS = {
    "flow_ratio": 0.98,
    "density_g_cm3": 1.24,
    "diameter_mm": 1.75,
    "nozzle_temperature_c": {"other": 220, "first_layer": 220},
    "bed_temperature_c": {"other": 55, "first_layer": 55},
}


class TestBuildCandidate:
    def test_carries_generic_params_as_is(self):
        candidate = build_candidate(
            vendor_slug="fdplast",
            vendor_name="FDplast",
            material_slug="pla",
            material_name="PLA",
            generic_name="Generic PLA",
            base_id="11111111-1111-1111-1111-111111111111",
            base_params=_BASE_PLA_PARAMS,
        )

        assert candidate.params == _BASE_PLA_PARAMS
        # own copy, not aliasing the caller's dict
        assert candidate.params is not _BASE_PLA_PARAMS

    def test_name_marks_ru_and_extrapolated(self):
        candidate = build_candidate(
            vendor_slug="fdplast",
            vendor_name="FDplast",
            material_slug="pla",
            material_name="PLA",
            generic_name="Generic PLA",
            base_id="11111111-1111-1111-1111-111111111111",
            base_params=_BASE_PLA_PARAMS,
        )

        assert "FDplast" in candidate.name
        assert "PLA" in candidate.name
        assert "RU" in candidate.name

    def test_external_ref_is_stable_per_vendor_and_material(self):
        candidate = build_candidate(
            vendor_slug="fdplast",
            vendor_name="FDplast",
            material_slug="pla",
            material_name="PLA",
            generic_name="Generic PLA",
            base_id="11111111-1111-1111-1111-111111111111",
            base_params=_BASE_PLA_PARAMS,
        )

        assert candidate.external_ref == external_ref("fdplast", "pla")

    def test_extrapolated_from_id_points_at_base(self):
        candidate = build_candidate(
            vendor_slug="fdplast",
            vendor_name="FDplast",
            material_slug="pla",
            material_name="PLA",
            generic_name="Generic PLA",
            base_id="11111111-1111-1111-1111-111111111111",
            base_params=_BASE_PLA_PARAMS,
        )

        assert candidate.extrapolated_from_id == "11111111-1111-1111-1111-111111111111"
        assert "Generic PLA" in candidate.extrapolation_reason
        assert "FDplast" in candidate.extrapolation_reason


def test_external_ref_differs_per_vendor_and_per_material():
    refs = {external_ref(v, m) for v in ("fdplast", "bestfilament") for m in ("pla", "petg")}
    assert len(refs) == 4


def test_build_extrapolation_reason_names_vendor_and_generic_source():
    reason = build_extrapolation_reason("Bestfilament", "Generic PETG")
    assert "Bestfilament" in reason
    assert "Generic PETG" in reason
    # honesty requirement (эпик MF-34 § «Риски») — must flag this is not
    # vendor-verified data, not silently pass extrapolation off as measured
    assert "экстраполир" in reason.lower()


def test_content_hash_stable_and_order_independent():
    a = {"b": 2, "a": 1}
    b = {"a": 1, "b": 2}
    assert content_hash(a) == content_hash(b)


def test_ru_vendors_and_materials_cover_epic_scope():
    vendor_slugs = {slug for slug, _name in RU_VENDORS}
    assert vendor_slugs == {"fdplast", "bestfilament", "rec", "plastico"}

    material_slugs = {slug for slug, _name, _generic in RU_MATERIALS}
    assert material_slugs == {"pla", "petg", "abs"}
