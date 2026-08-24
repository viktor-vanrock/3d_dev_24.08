import json
import os

import pytest

from mesh.snapmaker_u1_profile import (
    SnapmakerProfileError,
    build_volume_mm,
    resolve_snapmaker_u1_profile,
)


def _write(path, doc):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(doc), encoding="utf-8")


def _seed_synthetic_vendor(tmp_path):
    """Мини-вендор с той же формой inherits-цепочки, что реальный Snapmaker
    (base non-instantiable -> instantiable leaf), но синтетическими значениями —
    проверяет резолвер независимо от реального бандла Orca (который может быть
    недоступен в окружении без сети/CI-провижининга)."""
    root = tmp_path / "Snapmaker"
    _write(
        root / "machine" / "fdm_U1.json",
        {
            "type": "machine",
            "name": "fdm_U1",
            "instantiation": "false",
            "printable_height": "270.05",
        },
    )
    _write(
        root / "machine" / "Snapmaker U1 (0.4 nozzle).json",
        {
            "type": "machine",
            "name": "Snapmaker U1 (0.4 nozzle)",
            "inherits": "fdm_U1",
            "instantiation": "true",
            "printable_area": ["0.5x1", "270.5x1", "270.5x271", "0.5x271"],
        },
    )
    _write(
        root / "process" / "fdm_process_U1.json",
        {"type": "process", "name": "fdm_process_U1", "instantiation": "false", "wall_loops": "2"},
    )
    _write(
        root / "process" / "0.20 Standard @Snapmaker U1 (0.4 nozzle).json",
        {
            "type": "process",
            "name": "0.20 Standard @Snapmaker U1 (0.4 nozzle)",
            "inherits": "fdm_process_U1",
            "instantiation": "true",
            "layer_height": "0.2",
        },
    )
    _write(
        root / "filament" / "Snapmaker PLA @U1 base.json",
        {
            "type": "filament",
            "name": "Snapmaker PLA @U1 base",
            "instantiation": "false",
            "nozzle_temperature": ["210"],
        },
    )
    _write(
        root / "filament" / "Snapmaker PLA @U1.json",
        {
            "type": "filament",
            "name": "Snapmaker PLA @U1",
            "inherits": "Snapmaker PLA @U1 base",
            "instantiation": "true",
            "hot_plate_temp": ["55"],
        },
    )
    return root.parent


def test_resolve_snapmaker_u1_profile_merges_inherits_chain(tmp_path):
    profiles_dir = _seed_synthetic_vendor(tmp_path)
    profile = resolve_snapmaker_u1_profile(profiles_dir)

    # Дочерний файл переопределяет/дополняет родителя, не заменяет целиком.
    assert profile.printer["printable_height"] == "270.05"
    assert profile.printer["printable_area"] == ["0.5x1", "270.5x1", "270.5x271", "0.5x271"]
    assert profile.process["wall_loops"] == "2"
    assert profile.process["layer_height"] == "0.2"
    assert profile.filament["nozzle_temperature"] == ["210"]
    assert profile.filament["hot_plate_temp"] == ["55"]

    assert profile.source_name == "SoftFever/OrcaSlicer"
    assert profile.license == "AGPL-3.0"
    assert "machine/Snapmaker U1 (0.4 nozzle).json" in profile.source_ref


def test_resolve_snapmaker_u1_profile_content_hash_is_deterministic(tmp_path):
    profiles_dir = _seed_synthetic_vendor(tmp_path)
    first = resolve_snapmaker_u1_profile(profiles_dir)
    second = resolve_snapmaker_u1_profile(profiles_dir)
    assert first.content_hash == second.content_hash
    assert len(first.content_hash) == 64  # sha256 hex


def test_resolve_snapmaker_u1_profile_content_hash_changes_on_edit(tmp_path):
    profiles_dir = _seed_synthetic_vendor(tmp_path)
    before = resolve_snapmaker_u1_profile(profiles_dir)

    leaf = profiles_dir / "Snapmaker" / "filament" / "Snapmaker PLA @U1.json"
    doc = json.loads(leaf.read_text(encoding="utf-8"))
    doc["hot_plate_temp"] = ["60"]
    leaf.write_text(json.dumps(doc), encoding="utf-8")

    after = resolve_snapmaker_u1_profile(profiles_dir)
    assert before.content_hash != after.content_hash


def test_resolve_snapmaker_u1_profile_missing_profile_raises(tmp_path):
    profiles_dir = _seed_synthetic_vendor(tmp_path)
    with pytest.raises(SnapmakerProfileError):
        resolve_snapmaker_u1_profile(profiles_dir, printer_name="No Such Printer")


def test_resolve_snapmaker_u1_profile_rejects_geometry_drift(tmp_path):
    profiles_dir = _seed_synthetic_vendor(tmp_path)
    leaf = profiles_dir / "Snapmaker" / "machine" / "Snapmaker U1 (0.4 nozzle).json"
    doc = json.loads(leaf.read_text(encoding="utf-8"))
    # Стол вдруг стал заметно меньше паспортного 270×270 — резолвер должен
    # честно отказать, а не молча выдать неверную геометрию.
    doc["printable_area"] = ["0x0", "100x0", "100x100", "0x100"]
    leaf.write_text(json.dumps(doc), encoding="utf-8")

    with pytest.raises(SnapmakerProfileError):
        resolve_snapmaker_u1_profile(profiles_dir)


def test_build_volume_mm_parses_printable_area_and_height():
    printer = {
        "printable_area": ["0.5x1", "270.5x1", "270.5x271", "0.5x271"],
        "printable_height": "270.05",
    }
    volume = build_volume_mm(printer)
    assert volume["x"] == pytest.approx(270.0)
    assert volume["y"] == pytest.approx(270.0)
    assert volume["z"] == pytest.approx(270.05)


# --- живая проверка на реальном вендорском бандле Orca (skip без него) ------

_real_profiles_dir = os.getenv("MESH_ORCA_PROFILES_DIR")
_SKIP_REASON = "MESH_ORCA_PROFILES_DIR не задан — распакованный бандл Orca недоступен"


@pytest.mark.skipif(not _real_profiles_dir, reason=_SKIP_REASON)
def test_resolve_snapmaker_u1_profile_against_real_orca_bundle():
    from pathlib import Path

    profile = resolve_snapmaker_u1_profile(Path(_real_profiles_dir))
    assert profile.printer["gcode_flavor"] == "klipper"
    assert profile.build_volume_mm["x"] == pytest.approx(270.0, abs=1.0)
    assert profile.build_volume_mm["y"] == pytest.approx(270.0, abs=1.0)
    assert profile.build_volume_mm["z"] == pytest.approx(270.05, abs=1.0)
    assert profile.filament["compatible_printers"] == ["Snapmaker U1 (0.4 nozzle)"]
