import configparser
import io
import json
import zipfile

import pytest

from mesh.slicer_profile_export import (
    ExportAttribution,
    ProfileExportError,
    build_cura_bundle,
    build_orca_bundle,
    build_prusa_bundle,
)

_MACHINE = {
    "build_volume_mm": {"x": 220.0, "y": 220.0, "z": 250.0},
    "nozzle_diameter_mm": 0.4,
}

_PARAMS = {
    "layer_height_mm": 0.2,
    "first_layer_height_mm": 0.2,
    "print_speed_mm_s": 60,
    "first_layer_speed_mm_s": 20,
    "travel_speed_mm_s": 150,
    "infill_density_pct": 15,
    "infill_pattern": "grid",
    "wall_loops": 2,
    "top_shell_layers": 4,
    "bottom_shell_layers": 3,
    "support_enable": False,
    "support_type": "normal(auto)",
    "skirt_loops": 1,
    "brim_width_mm": 0,
    "nozzle_temperature_c": {"first_layer": 215, "other": 210},
    "bed_temperature_c": {"first_layer": 60, "other": 55},
    "max_volumetric_speed_mm3_s": 12,
    "flow_ratio": 0.98,
    "retraction_length_mm": 0.8,
    "retraction_speed_mm_s": 40,
    "z_hop_mm": 0.2,
    "density_g_cm3": 1.24,
    "diameter_mm": 1.75,
    "cost_per_kg": 20,
    "cooling_fan_speed_pct": {"min": 30, "max": 100},
}

_ATTRIBUTION = ExportAttribution(
    source_name="softfever_orcaslicer",
    source_url=None,
    source_ref="Creality/process/0.20mm Standard @Creality Ender3.json",
    license="AGPL-3.0",
    confidence=1.0,
    extrapolated=False,
    disclaimer="Профиль подобран детерминированно.",
)


# --- OrcaSlicer --------------------------------------------------------------


def test_orca_bundle_contains_three_valid_presets():
    data, manifest = build_orca_bundle(
        _PARAMS,
        _MACHINE,
        printer_name="Test Printer",
        filament_name="Test PLA",
        attribution=_ATTRIBUTION,
    )

    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        names = set(archive.namelist())
        assert names == {"printer.json", "process.json", "filament.json"}
        printer = json.loads(archive.read("printer.json"))
        process = json.loads(archive.read("process.json"))
        filament = json.loads(archive.read("filament.json"))

    assert printer["type"] == "machine"
    assert printer["printable_area"] == ["0x0", "220x0", "220x220", "0x220"]
    assert printer["printable_height"] == "250"
    assert printer["nozzle_diameter"] == ["0.4"]

    assert process["type"] == "process"
    assert process["layer_height"] == "0.2"
    assert process["outer_wall_speed"] == "60"
    assert process["sparse_infill_density"] == "15%"
    assert process["enable_support"] == "0"
    assert process["compatible_printers"] == [printer["name"], printer["inherits"]]

    assert filament["type"] == "filament"
    assert filament["nozzle_temperature"] == ["210"]
    assert filament["nozzle_temperature_initial_layer"] == ["215"]
    assert filament["hot_plate_temp"] == ["55"]
    assert filament["filament_flow_ratio"] == ["0.98"]
    assert filament["compatible_printers"] == [printer["name"], printer["inherits"]]

    assert manifest["slicer"] == "orcaslicer"
    assert manifest["attribution"]["license"] == "AGPL-3.0"


def test_orca_bundle_links_process_and_filament_to_printer():
    """MF-1919: без анкор-связки headless OrcaSlicer CLI реально отклоняет
    бандл (`process not compatible with printer`, см.
    `docs/infra/slicer.ci.headless.md`) — CLI резолвит printer-пресет без
    известного `setting_id` в сырое значение `inherits`, не в `name`.

    MF-1920: `compatible_printers` содержит ОБА значения — `printer.name`
    (иначе регрессирует реальный GUI-импорт, `is_compatible_with_printer`
    сравнивает по имени, см. докстринг секции экспортёра «ДОБАВЛЕНО
    MF-1920») И синтетический якорь `printer.inherits` (иначе регрессирует
    headless CLI, см. MF-1919 выше) — оба независимо проверены живым
    прогоном `orca-slicer` v2.4.2."""
    data, _manifest = build_orca_bundle(
        _PARAMS,
        _MACHINE,
        printer_name="Test Printer",
        filament_name="Test PLA",
        attribution=_ATTRIBUTION,
    )

    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        printer = json.loads(archive.read("printer.json"))
        process = json.loads(archive.read("process.json"))
        filament = json.loads(archive.read("filament.json"))

    assert printer["inherits"]
    assert printer["name"] == "Test Printer"
    assert process["compatible_printers"] == [printer["name"], printer["inherits"]]
    assert filament["compatible_printers"] == [printer["name"], printer["inherits"]]


def test_orca_bundle_requires_geometry():
    with pytest.raises(ProfileExportError):
        build_orca_bundle(
            _PARAMS, {}, printer_name="X", filament_name="Y", attribution=_ATTRIBUTION
        )


def test_orca_bundle_requires_nonempty_params():
    with pytest.raises(ProfileExportError):
        build_orca_bundle(
            {}, _MACHINE, printer_name="X", filament_name="Y", attribution=_ATTRIBUTION
        )


# --- PrusaSlicer ---------------------------------------------------------


def test_prusa_bundle_has_named_sections_and_presets_header():
    data, manifest = build_prusa_bundle(
        _PARAMS,
        _MACHINE,
        printer_name="Test Printer",
        filament_name="Test PLA",
        attribution=_ATTRIBUTION,
    )
    text = data.decode("utf-8")

    parser = configparser.ConfigParser(interpolation=None)
    parser.optionxform = str
    parser.read_string(text)

    assert parser.has_section("print:3mf.tech - Test Printer")
    assert parser.has_section("filament:3mf.tech - Test PLA")
    assert parser.has_section("printer:Test Printer")
    assert parser.has_section("presets")

    process = parser["print:3mf.tech - Test Printer"]
    assert process["layer_height"] == "0.2"
    assert process["fill_density"] == "15%"
    assert process["support_material"] == "0"

    filament = parser["filament:3mf.tech - Test PLA"]
    assert filament["temperature"] == "210"
    assert filament["bed_temperature"] == "55"

    printer = parser["printer:Test Printer"]
    assert printer["bed_shape"] == "0x0,220x0,220x220,0x220"
    assert printer["max_print_height"] == "250"
    assert printer["nozzle_diameter"] == "0.4"

    presets = parser["presets"]
    assert presets["print"] == "3mf.tech - Test Printer"
    assert presets["filament"] == "3mf.tech - Test PLA"
    assert presets["printer"] == "Test Printer"

    assert manifest["slicer"] == "prusaslicer"


def test_prusa_bundle_requires_geometry():
    with pytest.raises(ProfileExportError):
        build_prusa_bundle(
            _PARAMS, {}, printer_name="X", filament_name="Y", attribution=_ATTRIBUTION
        )


# --- Cura ------------------------------------------------------------------


def test_cura_bundle_is_zip_of_instance_container():
    data, manifest = build_cura_bundle(
        _PARAMS, printer_name="Test Printer", filament_name="Test PLA", attribution=_ATTRIBUTION
    )

    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        names = archive.namelist()
        assert len(names) == 1
        container_text = archive.read(names[0]).decode("utf-8")

    parser = configparser.ConfigParser(interpolation=None)
    parser.optionxform = str
    parser.read_string(container_text)

    assert parser["general"]["version"] == "4"
    assert parser["general"]["definition"] == "fdmprinter"
    assert parser["metadata"]["type"] == "quality_changes"
    assert parser["metadata"]["setting_version"] == "25"

    values = parser["values"]
    assert values["layer_height"] == "0.2"
    assert values["speed_print"] == "60"
    assert values["infill_sparse_density"] == "15"
    assert values["support_enable"] == "False"
    assert values["material_print_temperature"] == "210"
    assert values["material_bed_temperature"] == "55"
    assert values["retraction_amount"] == "0.8"

    assert manifest["slicer"] == "cura"
    assert manifest["setting_version_placeholder"] == 25


def test_cura_bundle_requires_nonempty_params():
    with pytest.raises(ProfileExportError):
        build_cura_bundle({}, printer_name="X", filament_name="Y", attribution=_ATTRIBUTION)


def test_cura_bundle_setting_version_is_overridable():
    _, manifest = build_cura_bundle(
        _PARAMS,
        printer_name="Test Printer",
        filament_name="Test PLA",
        attribution=_ATTRIBUTION,
        setting_version=23,
    )
    assert manifest["setting_version_placeholder"] == 23
