import os
from pathlib import Path

import pytest

from mesh.slicer_ci_validate import (
    _collect_defaults,
    _cura_arg_fmt,
    _cura_setting_args,
    validate_cura_import,
    validate_orca_import,
    validate_prusa_import,
)
from mesh.slicer_profile_export import (
    ExportAttribution,
    build_cura_bundle,
    build_orca_bundle,
    build_prusa_bundle,
)

_MACHINE = {"build_volume_mm": {"x": 220.0, "y": 220.0, "z": 250.0}, "nozzle_diameter_mm": 0.4}
_PARAMS = {
    "layer_height_mm": 0.2,
    "first_layer_height_mm": 0.2,
    "print_speed_mm_s": 60,
    "infill_density_pct": 15,
    "nozzle_temperature_c": {"other": 200.0, "first_layer": 205.0},
    "bed_temperature_c": {"other": 60.0, "first_layer": 60.0},
    "flow_ratio": 1.0,
    "retraction_length_mm": 0.8,
    "retraction_speed_mm_s": 40,
    "density_g_cm3": 1.24,
    "diameter_mm": 1.75,
}
_ATTRIBUTION = ExportAttribution(
    source_name="test", source_url=None, source_ref=None, license="MIT",
    confidence=1.0, extrapolated=False, disclaimer="test",
)


# --- pure logic (no binaries needed) -----------------------------------------


def test_collect_defaults_walks_nested_children():
    doc = {
        "settings": {
            "top_bottom": {
                "children": {
                    "roofing_layer_count": {"default_value": 0},
                    "no_default_here": {"description": "no default_value key"},
                }
            },
            "layer_height": {"default_value": 0.2},
        }
    }
    defaults = _collect_defaults(doc)
    assert defaults == {"roofing_layer_count": 0, "layer_height": 0.2}


def test_cura_arg_fmt_bool_and_list():
    assert _cura_arg_fmt(True) == "true"
    assert _cura_arg_fmt(False) == "false"
    assert _cura_arg_fmt([1, 2]) == "[1, 2]"
    assert _cura_arg_fmt(0.2) == "0.2"


def test_cura_setting_args_pairs_dash_s_with_key_value():
    args = _cura_setting_args({"layer_height": 0.2, "support_enable": False})
    assert args == ["-s", "layer_height=0.2", "-s", "support_enable=false"]


# --- real binary integration (skipped without headless slicers) -------------

_orca_bin = os.getenv("MESH_ORCA_SLICER_BIN")
_prusa_bin = os.getenv("MESH_PRUSA_SLICER_BIN")
_cura_bin = os.getenv("MESH_CURA_BIN")


def _write_probe_stl(path: Path) -> None:
    trimesh = pytest.importorskip("trimesh")
    trimesh.creation.box(extents=[10.0, 10.0, 10.0]).export(path)


_ORCA_SKIP_REASON = "MESH_ORCA_SLICER_BIN не задан — headless Orca недоступен"
_PRUSA_SKIP_REASON = "MESH_PRUSA_SLICER_BIN не задан — headless Prusa недоступен"
_CURA_SKIP_REASON = "MESH_CURA_BIN не задан — headless Cura недоступен"


@pytest.mark.skipif(not _orca_bin, reason=_ORCA_SKIP_REASON)
def test_validate_orca_import_real_binary(tmp_path):
    data, _manifest = build_orca_bundle(
        _PARAMS, _MACHINE, printer_name="CI Synthetic Printer", filament_name="CI PLA",
        attribution=_ATTRIBUTION,
    )
    stl_path = tmp_path / "probe.stl"
    _write_probe_stl(stl_path)

    result = validate_orca_import(
        data, orca_bin=_orca_bin, stl_path=stl_path, workdir=tmp_path / "orca"
    )
    assert result.ok, result.detail


@pytest.mark.skipif(not _prusa_bin, reason=_PRUSA_SKIP_REASON)
def test_validate_prusa_import_real_binary(tmp_path):
    data, _manifest = build_prusa_bundle(
        _PARAMS, _MACHINE, printer_name="CI Synthetic Printer", filament_name="CI PLA",
        attribution=_ATTRIBUTION,
    )
    stl_path = tmp_path / "probe.stl"
    _write_probe_stl(stl_path)

    result = validate_prusa_import(
        data, prusa_bin=_prusa_bin, stl_path=stl_path, workdir=tmp_path / "prusa"
    )
    assert result.ok, result.detail


@pytest.mark.skipif(not _cura_bin, reason=_CURA_SKIP_REASON)
def test_validate_cura_import_real_binary(tmp_path):
    appdir = Path(_cura_bin).resolve().parent
    engine = appdir / "CuraEngine"
    definitions = appdir / "share" / "cura" / "resources" / "definitions"
    if not engine.is_file() or not definitions.is_dir():
        pytest.skip("CuraEngine/definitions не найдены рядом с MESH_CURA_BIN")

    data, _manifest = build_cura_bundle(
        _PARAMS, printer_name="CI Synthetic Printer", filament_name="CI PLA",
        attribution=_ATTRIBUTION,
    )
    stl_path = tmp_path / "probe.stl"
    _write_probe_stl(stl_path)

    result = validate_cura_import(
        data, cura_engine_bin=engine, library_dir=appdir, definitions_dir=definitions,
        stl_path=stl_path, workdir=tmp_path / "cura",
    )
    assert result.ok, result.detail
