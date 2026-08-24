"""Тесты порта `giga.slicer_ai.matcher_port` — параллельные сценариям
`apps/api/src/slicerProfiles/matcher.test.ts` (MF-412), чтобы порт не
разъехался с оригиналом молча (см. докстринг `matcher_port.py`)."""

from __future__ import annotations

import pytest

from giga.slicer_ai.matcher_port import (
    BaselineProfile,
    FilamentInput,
    NoMatchingProfileError,
    PrinterInput,
    recommend_profile,
)

PRINTER = PrinterInput(
    id="printer-1",
    nozzle_diameter_mm=0.4,
    kinematics="corexy",
    build_volume_mm={"x": 256, "y": 256, "z": 256},
    max_nozzle_temp_c=300,
    max_bed_temp_c=110,
    max_print_speed_mm_s=500,
)

FILAMENT = FilamentInput(id="filament-1", material_class="pla", diameter_mm=1.75)


def _profile(**overrides) -> BaselineProfile:
    base = dict(
        id="profile-1",
        profile_class="process",
        slicer="orcaslicer",
        name="CoreXY PLA 0.20",
        machine_id="printer-1",
        material_id=None,
        inherits_id=None,
        params={
            "nozzle_temperature_c": {"first_layer": 220, "other": 215},
            "bed_temperature_c": {"first_layer": 70, "other": 60},
            "print_speed_mm_s": 200,
            "kinematics": "corexy",
            "nozzle_diameter_mm": 0.4,
            "build_volume_mm": {"x": 256, "y": 256, "z": 256},
        },
        source_name="OrcaSlicer",
        source_url=None,
        source_ref="profiles/corexy-pla.json",
        license="AGPL-3.0-or-later",
        confidence=1,
        extrapolated_from_id=None,
    )
    base.update(overrides)
    return BaselineProfile(**base)


def test_exact_base_applies_material_and_intent_deltas():
    result = recommend_profile(
        PRINTER,
        FILAMENT,
        [_profile()],
        [
            _profile(
                id="filament-pla",
                profile_class="filament",
                machine_id=None,
                material_id="filament-1",
                params={
                    "nozzle_temperature_c": {"first_layer": 210, "other": 205},
                    "cooling_fan_speed_pct": {"min": 30, "max": 80},
                    "intent_overrides": {"strength": {"print_speed_mm_s": 150}},
                },
            )
        ],
        "strength",
    )

    assert result.extrapolated is False
    assert result.confidence == 1
    assert result.params["nozzle_temperature_c"] == {"first_layer": 210, "other": 205}
    assert result.params["print_speed_mm_s"] == 150
    assert result.params["cooling_fan_speed_pct"] == {"min": 30, "max": 80}
    assert result.origin.base_profile_id == "profile-1"
    reasons = {c.field: c.reason for c in result.origin.changed_fields}
    assert "материал" in reasons["nozzle_temperature_c"]
    assert "прочность" in reasons["print_speed_mm_s"]


def test_nearest_class_when_no_exact_base_lowers_confidence():
    overrides = {"id": "unknown-printer", "kinematics": "bedslinger"}
    printer = PrinterInput(**{**PRINTER.__dict__, **overrides})
    result = recommend_profile(
        printer,
        FILAMENT,
        [_profile(machine_id="other-printer", confidence=0.9)],
        [],
    )

    assert result.extrapolated is True
    assert result.confidence < 0.9
    assert "экстраполирован" in result.disclaimer
    assert result.origin.base_profile_id == "profile-1"


def test_clamps_temperatures_and_speeds_to_passport():
    overrides = {"max_nozzle_temp_c": 240, "max_bed_temp_c": 80, "max_print_speed_mm_s": 120}
    printer = PrinterInput(**{**PRINTER.__dict__, **overrides})
    result = recommend_profile(
        printer,
        FILAMENT,
        [
            _profile(
                params={
                    "nozzle_temperature_c": {"first_layer": 280, "other": 270},
                    "bed_temperature_c": {"first_layer": 100, "other": 90},
                    "print_speed_mm_s": 240,
                    "travel_speed_mm_s": 500,
                }
            )
        ],
        [],
    )

    assert result.params["nozzle_temperature_c"] == {"first_layer": 240, "other": 240}
    assert result.params["bed_temperature_c"] == {"first_layer": 80, "other": 80}
    assert result.params["print_speed_mm_s"] == 120
    assert result.params["travel_speed_mm_s"] == 120
    reasons = {c.field: c.reason for c in result.origin.changed_fields}
    assert "паспорт" in reasons["nozzle_temperature_c"]
    assert "паспорт" in reasons["print_speed_mm_s"]


def test_material_overlay_picks_matching_nozzle_diameter():
    result = recommend_profile(
        PRINTER,
        FILAMENT,
        [_profile()],
        [
            _profile(
                id="aa-08",
                profile_class="filament",
                machine_id=None,
                material_id="filament-1",
                params={"nozzle_diameter_mm": 0.8, "flow_ratio": 0.95},
            ),
            _profile(
                id="zz-04",
                profile_class="filament",
                machine_id=None,
                material_id="filament-1",
                params={"nozzle_diameter_mm": 0.4, "flow_ratio": 1.02},
            ),
        ],
    )

    assert result.params["flow_ratio"] == 1.02
    assert result.origin.overlay_profile_ids == ["zz-04"]


def test_no_matching_profile_raises():
    with pytest.raises(NoMatchingProfileError):
        recommend_profile(PRINTER, FILAMENT, [], [])
