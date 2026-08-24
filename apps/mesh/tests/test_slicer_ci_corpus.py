import json

import pytest

from mesh.slicer_ci_corpus import (
    CorpusError,
    build_corpus,
    load_orca_vendor_machines,
    load_orca_vendor_materials,
    machine_from_orca_printer_json,
    params_from_orca_filament_json,
)

_MACHINE_DOC = {
    "type": "machine",
    "name": "Creality Ender-3 V2 0.4 nozzle",
    "from": "system",
    "instantiation": "true",
    "printable_area": ["0x0", "220x0", "220x220", "0x220"],
    "printable_height": "250",
    "nozzle_diameter": ["0.4"],
}

_MACHINE_DELTA_DOC = {
    "type": "machine",
    "name": "fdm_creality_common",
    "from": "system",
    "instantiation": "false",
}

_FILAMENT_PLA_DOC = {
    "type": "filament",
    "name": "fdm_filament_pla",
    "instantiation": "false",
    "nozzle_temperature": ["220"],
    "nozzle_temperature_initial_layer": ["220"],
    "hot_plate_temp": ["60"],
    "hot_plate_temp_initial_layer": ["60"],
    "filament_max_volumetric_speed": ["12"],
    "filament_density": ["1.24"],
}

_FILAMENT_PETG_DOC = {
    "type": "filament",
    "name": "fdm_filament_petg",
    "instantiation": "false",
    "nozzle_temperature": ["240"],
    "hot_plate_temp": ["80"],
    "filament_density": ["1.27"],
}

_FILAMENT_ABS_DOC = {
    "type": "filament",
    "name": "fdm_filament_abs",
    "instantiation": "false",
    "nozzle_temperature": ["250"],
    "hot_plate_temp": ["90"],
    "filament_density": ["1.04"],
}


def _write(path, doc):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(doc), encoding="utf-8")


def _seed_vendor(tmp_path, vendor="Creality", *, machine_count=3):
    root = tmp_path / vendor
    for i in range(machine_count):
        doc = dict(_MACHINE_DOC)
        doc["name"] = f"{_MACHINE_DOC['name']} #{i}"
        _write(root / "machine" / f"printer_{i}.json", doc)
    _write(root / "machine" / "common.json", _MACHINE_DELTA_DOC)
    _write(root / "filament" / "fdm_filament_pla.json", _FILAMENT_PLA_DOC)
    _write(root / "filament" / "fdm_filament_petg.json", _FILAMENT_PETG_DOC)
    _write(root / "filament" / "fdm_filament_abs.json", _FILAMENT_ABS_DOC)
    return root.parent


def test_machine_from_orca_printer_json():
    machine = machine_from_orca_printer_json(_MACHINE_DOC)
    assert machine == {
        "build_volume_mm": {"x": 220.0, "y": 220.0, "z": 250.0},
        "nozzle_diameter_mm": 0.4,
    }


def test_machine_from_orca_printer_json_accepts_comma_joined_string_area():
    """Некоторые реальные вендорские machine-пресеты (напр.
    `Creality/machine/Creality Ender-3 V4 0.4 nozzle.json`) несут
    `printable_area` одной строкой через запятую, не JSON-списком —
    обе формы должны резолвиться одинаково (см. докстринг функции).
    """
    doc = dict(_MACHINE_DOC)
    doc["printable_area"] = "0x0,220x0,220x220,0x220"
    machine = machine_from_orca_printer_json(doc)
    assert machine == {
        "build_volume_mm": {"x": 220.0, "y": 220.0, "z": 250.0},
        "nozzle_diameter_mm": 0.4,
    }


def test_params_from_orca_filament_json_falls_back_first_layer_to_other():
    params = params_from_orca_filament_json(_FILAMENT_PETG_DOC)
    assert params["nozzle_temperature_c"] == {"other": 240.0, "first_layer": 240.0}
    assert params["bed_temperature_c"] == {"other": 80.0, "first_layer": 80.0}
    assert params["density_g_cm3"] == 1.27


def test_load_orca_vendor_machines_skips_deltas_and_abstract_bases(tmp_path):
    _seed_vendor(tmp_path, machine_count=3)
    machines = load_orca_vendor_machines(tmp_path, "Creality")
    names = [name for name, _doc in machines]
    assert len(machines) == 3
    assert all("common" not in name for name in names)


def test_load_orca_vendor_machines_respects_limit(tmp_path):
    _seed_vendor(tmp_path, machine_count=5)
    machines = load_orca_vendor_machines(tmp_path, "Creality", limit=2)
    assert len(machines) == 2


def test_load_orca_vendor_machines_missing_vendor_raises(tmp_path):
    with pytest.raises(CorpusError):
        load_orca_vendor_machines(tmp_path, "NoSuchVendor")


def test_load_orca_vendor_materials_requires_all_three(tmp_path):
    root = tmp_path / "Partial"
    _write(root / "filament" / "fdm_filament_pla.json", _FILAMENT_PLA_DOC)
    with pytest.raises(CorpusError):
        load_orca_vendor_materials(tmp_path, "Partial")


def test_load_orca_vendor_materials_rejects_delta_without_temps(tmp_path):
    root = tmp_path / "DeltaOnly"
    for material, doc in (
        ("pla", {"instantiation": "false", "inherits": "fdm_filament_common"}),
        ("petg", _FILAMENT_PETG_DOC),
        ("abs", _FILAMENT_ABS_DOC),
    ):
        _write(root / "filament" / f"fdm_filament_{material}.json", doc)
    with pytest.raises(CorpusError):
        load_orca_vendor_materials(tmp_path, "DeltaOnly")


def test_build_corpus_covers_epic_threshold(tmp_path):
    _seed_vendor(tmp_path, machine_count=50)
    corpus = build_corpus(tmp_path, printer_limit=50)

    printers = {entry.printer_name for entry in corpus}
    materials = {entry.material for entry in corpus}
    assert len(printers) >= 50
    assert materials == {"pla", "petg", "abs"}
    assert len(corpus) == len(printers) * 3

    sample = corpus[0]
    assert sample.machine["nozzle_diameter_mm"] == 0.4
    assert "nozzle_temperature_c" in sample.params
    assert sample.params["layer_height_mm"] == 0.2
