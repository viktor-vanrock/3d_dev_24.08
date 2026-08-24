import math

import pytest

from mesh.slicer_preflight import (
    BoundingBoxMM,
    PlateInstanceGeometry,
    PlateLayoutError,
    PreflightError,
    UnsupportedToolheadError,
    check_bed_fit,
    check_bed_origin,
    check_finite_bbox,
    check_plate_layout,
    check_plate_toolheads,
    check_profile_hash,
    check_single_toolhead,
    check_units,
    compute_placed_footprint,
)

_U1_BUILD_VOLUME = {"x": 270.0, "y": 270.0, "z": 270.05}


def test_check_finite_bbox_accepts_positive_finite():
    check_finite_bbox(BoundingBoxMM(x=10.0, y=20.0, z=30.0))


@pytest.mark.parametrize("bad", [math.nan, math.inf, -math.inf, 0.0, -5.0])
def test_check_finite_bbox_rejects_non_finite_or_non_positive(bad):
    with pytest.raises(PreflightError) as exc:
        check_finite_bbox(BoundingBoxMM(x=bad, y=10.0, z=10.0))
    assert exc.value.code == "NON_FINITE_GEOMETRY"


def test_check_units_accepts_mm():
    check_units("mm")


@pytest.mark.parametrize("unit", ["in", "cm", "m", ""])
def test_check_units_rejects_non_mm(unit):
    with pytest.raises(PreflightError) as exc:
        check_units(unit)
    assert exc.value.code == "UNSUPPORTED_UNITS"


def test_check_bed_fit_accepts_part_within_u1_bed():
    check_bed_fit(BoundingBoxMM(x=243.4, y=204.9, z=87.0), _U1_BUILD_VOLUME)


def test_check_bed_fit_rejects_oversized_part():
    with pytest.raises(PreflightError) as exc:
        check_bed_fit(BoundingBoxMM(x=300.0, y=100.0, z=50.0), _U1_BUILD_VOLUME)
    assert exc.value.code == "OUT_OF_BED"
    assert "x" in str(exc.value)


def test_check_bed_fit_rejects_part_that_only_fits_without_clearance():
    bbox = BoundingBoxMM(x=269.0, y=100.0, z=50.0)
    check_bed_fit(bbox, _U1_BUILD_VOLUME, clearance_mm=0.0)
    with pytest.raises(PreflightError) as exc:
        check_bed_fit(bbox, _U1_BUILD_VOLUME, clearance_mm=1.0)
    assert exc.value.code == "OUT_OF_BED"


def test_check_single_toolhead_accepts_toolhead_zero():
    check_single_toolhead(0)


@pytest.mark.parametrize("toolhead", [1, 2, 3, -1])
def test_check_single_toolhead_rejects_other_toolheads(toolhead):
    with pytest.raises(PreflightError) as exc:
        check_single_toolhead(toolhead)
    assert exc.value.code == "UNSUPPORTED_TOOLHEAD"


def test_check_profile_hash_accepts_matching_hash():
    check_profile_hash("abc123", "abc123")


def test_check_profile_hash_rejects_mismatch():
    with pytest.raises(PreflightError) as exc:
        check_profile_hash("abc123", "def456")
    assert exc.value.code == "PROFILE_HASH_MISMATCH"


@pytest.mark.parametrize("origin", ["center", "front_left", "explicit", None])
def test_check_bed_origin_accepts_known_values_and_absent(origin):
    check_bed_origin(origin)


@pytest.mark.parametrize("origin", ["", "top_left", "CENTER", "Center", "corner"])
def test_check_bed_origin_rejects_unknown_values(origin):
    # MF-1994: `bed_geometry` присутствует и несёт непустой, но не
    # распознанный `origin` — честный отказ вместо угадывания системы
    # координат (отсутствующий origin — легаси-фикстура, обрабатывается
    # отдельно на вызывающей стороне, не эта функция).
    with pytest.raises(PreflightError) as exc:
        check_bed_origin(origin)
    assert exc.value.code == "UNSUPPORTED_BED_ORIGIN"


## Per-instance plate layout (MF-1987, project-slice-request.v1)


def _instance(instance_id, x_mm, y_mm, *, rotation_z_deg=0.0, scale=1.0, toolhead_index=0):
    return PlateInstanceGeometry(
        instance_id=instance_id,
        local_bbox=BoundingBoxMM(x=10.0, y=10.0, z=10.0),
        x_mm=x_mm,
        y_mm=y_mm,
        rotation_z_deg=rotation_z_deg,
        scale=scale,
        toolhead_index=toolhead_index,
    )


def test_compute_placed_footprint_no_rotation_matches_scaled_bbox():
    footprint = compute_placed_footprint(_instance("a", 50.0, 50.0, scale=2.0))
    assert footprint.min_x == pytest.approx(40.0)
    assert footprint.max_x == pytest.approx(60.0)
    assert footprint.size_x == pytest.approx(20.0)
    assert footprint.height_mm == pytest.approx(20.0)


def test_compute_placed_footprint_45deg_rotation_grows_aabb():
    footprint = compute_placed_footprint(_instance("a", 0.0, 0.0, rotation_z_deg=45.0))
    # Повёрнутый на 45° квадрат 10×10 даёт AABB с полудиагональю 10*sqrt(2)/2.
    assert footprint.size_x == pytest.approx(10.0 * math.sqrt(2), rel=1e-6)


def test_compute_placed_footprint_rejects_non_finite_scale():
    with pytest.raises(PreflightError) as exc:
        compute_placed_footprint(_instance("a", 0.0, 0.0, scale=math.nan))
    assert exc.value.code == "NON_FINITE_GEOMETRY"


def test_check_plate_layout_accepts_non_overlapping_instances():
    footprints = check_plate_layout(
        [_instance("a", 50.0, 50.0), _instance("b", 100.0, 50.0)], _U1_BUILD_VOLUME
    )
    assert set(footprints) == {"a", "b"}


def test_check_plate_layout_rejects_colliding_instances():
    with pytest.raises(PlateLayoutError) as exc:
        check_plate_layout(
            [_instance("a", 50.0, 50.0), _instance("b", 52.0, 50.0)], _U1_BUILD_VOLUME
        )
    codes = {(v.instance_id, v.code) for v in exc.value.violations}
    assert codes == {("a", "collision"), ("b", "collision")}


def test_check_plate_layout_rejects_instance_outside_bed():
    with pytest.raises(PlateLayoutError) as exc:
        check_plate_layout([_instance("a", 268.0, 50.0)], _U1_BUILD_VOLUME)
    assert [(v.instance_id, v.code) for v in exc.value.violations] == [("a", "outside_bed")]


def test_check_plate_layout_rejects_height_exceeded():
    tall = PlateInstanceGeometry(
        instance_id="a",
        local_bbox=BoundingBoxMM(x=10.0, y=10.0, z=300.0),
        x_mm=50.0,
        y_mm=50.0,
        rotation_z_deg=0.0,
    )
    with pytest.raises(PlateLayoutError) as exc:
        check_plate_layout([tall], _U1_BUILD_VOLUME)
    assert [(v.instance_id, v.code) for v in exc.value.violations] == [("a", "height_exceeded")]


def test_check_plate_layout_rejects_clearance_violation():
    with pytest.raises(PlateLayoutError) as exc:
        check_plate_layout(
            [_instance("a", 50.0, 50.0), _instance("b", 61.0, 50.0)],
            _U1_BUILD_VOLUME,
            clearance_mm=5.0,
        )
    codes = {(v.instance_id, v.code) for v in exc.value.violations}
    assert codes == {("a", "clearance_failed"), ("b", "clearance_failed")}


def test_check_plate_layout_collects_all_violations_not_fail_fast():
    with pytest.raises(PlateLayoutError) as exc:
        check_plate_layout(
            [_instance("a", 268.0, 50.0), _instance("b", -5.0, 50.0)], _U1_BUILD_VOLUME
        )
    assert {v.instance_id for v in exc.value.violations} == {"a", "b"}


def test_check_plate_toolheads_accepts_toolhead_zero():
    check_plate_toolheads([_instance("a", 0.0, 0.0), _instance("b", 50.0, 0.0)])


def test_check_plate_toolheads_rejects_and_collects_all_offenders():
    with pytest.raises(UnsupportedToolheadError) as exc:
        check_plate_toolheads(
            [
                _instance("a", 0.0, 0.0, toolhead_index=1),
                _instance("b", 50.0, 0.0, toolhead_index=0),
                _instance("c", 100.0, 0.0, toolhead_index=2),
            ]
        )
    assert exc.value.instance_ids == ["a", "c"]
