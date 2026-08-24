"""Юнит-тесты идемпотентного seed'а `slicer_profiles` для Snapmaker U1 (MF-1989)
на фейковой БД — без реального Postgres (тот же принцип, что
`test_slicing_queue.py`: интеграционный прогон против настоящей БД — вручную,
sandbox-db/dev). `FakeConn` эмулирует именно то поведение, которое проверяем:
конфликт-таргет `(slicer, setting_id)` — повторный upsert с тем же вводом не
плодит новую строку, переписывает существующую по id.
"""

import json

import pytest

from mesh.snapmaker_u1_profile import SnapmakerProfileError, resolve_snapmaker_u1_profile
from mesh.snapmaker_u1_profile_seed import (
    _normalize_machine_params,
    _normalize_process_or_filament_params,
    seed_snapmaker_u1_slicer_profiles,
)


def _write(path, doc):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(doc), encoding="utf-8")


def _seed_synthetic_vendor(tmp_path):
    """Тот же синтетический мини-вендор, что `test_snapmaker_u1_profile.py`,
    плюс `setting_id` на каждом инстанцируемом (`instantiation: true`) листе —
    реальный вендорский Orca-бандл всегда несёт его там, `seed`-модуль этого
    требует (конфликт-таргет upsert'а — `(slicer, setting_id)`)."""
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
            "setting_id": "test-machine-id",
            "printable_area": ["0.5x1", "270.5x1", "270.5x271", "0.5x271"],
            "nozzle_diameter": ["0.4", "0.4", "0.4", "0.4"],
            "gcode_flavor": "klipper",
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
            "setting_id": "test-process-id",
            "layer_height": "0.2",
            "sparse_infill_density": "15%",
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
            "setting_id": "test-filament-id",
            "hot_plate_temp": ["55"],
        },
    )
    return root.parent


class FakeCursor:
    def __init__(self, conn):
        self._conn = conn
        self._last = None

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def execute(self, sql, params=()):
        normalized = " ".join(sql.split())
        self._conn.executed.append((normalized, params))
        assert (
            "on conflict (slicer, setting_id) where setting_id is not null do update" in normalized
        )
        (
            profile_class,
            slicer,
            setting_id,
            name,
            params_json,
            source_name,
            source_url,
            source_ref,
            license_,
            content_hash,
        ) = params
        key = (slicer, setting_id)
        row = self._conn.rows.get(key)
        if row is None:
            row_id = f"row-{len(self._conn.rows) + 1}"
            self._conn.rows[key] = {"id": row_id}
        else:
            row_id = row["id"]
        self._conn.rows[key].update(
            {
                "profile_class": profile_class,
                "name": name,
                "params": params_json,
                "content_hash": content_hash,
            }
        )
        self._last = (row_id,)

    def fetchone(self):
        return self._last


class FakeConn:
    def __init__(self):
        self.rows = {}
        self.executed = []

    def cursor(self):
        return FakeCursor(self)

    def commit(self):
        pass


def test_seed_is_idempotent_no_duplicate_rows(tmp_path):
    profiles_dir = _seed_synthetic_vendor(tmp_path)
    conn = FakeConn()

    first = seed_snapmaker_u1_slicer_profiles(conn, profiles_dir)
    assert len(conn.rows) == 3
    second = seed_snapmaker_u1_slicer_profiles(conn, profiles_dir)

    assert len(conn.rows) == 3  # повторный прогон не плодит новых строк
    assert first == second  # те же id для machine/process/filament


def test_seed_upserts_by_slicer_and_setting_id(tmp_path):
    profiles_dir = _seed_synthetic_vendor(tmp_path)
    conn = FakeConn()

    ids = seed_snapmaker_u1_slicer_profiles(conn, profiles_dir)

    assert set(ids) == {"machine", "process", "filament"}
    assert conn.rows[("orcaslicer", "test-machine-id")]["id"] == ids["machine"]
    assert conn.rows[("orcaslicer", "test-process-id")]["id"] == ids["process"]
    assert conn.rows[("orcaslicer", "test-filament-id")]["id"] == ids["filament"]
    process_name = "0.20 Standard @Snapmaker U1 (0.4 nozzle)"
    assert conn.rows[("orcaslicer", "test-process-id")]["name"] == process_name
    assert conn.rows[("orcaslicer", "test-filament-id")]["name"] == "Snapmaker PLA @U1"


def test_seed_reflects_bundle_edit_on_next_run(tmp_path):
    """Бандл поменялся (например, апгрейд SOURCE_VERSION вендора) — та же
    строка (по setting_id) получает новый content_hash/params, не новую
    строку."""
    profiles_dir = _seed_synthetic_vendor(tmp_path)
    conn = FakeConn()

    before = seed_snapmaker_u1_slicer_profiles(conn, profiles_dir)
    before_hash = conn.rows[("orcaslicer", "test-process-id")]["content_hash"]

    leaf = profiles_dir / "Snapmaker" / "process" / "0.20 Standard @Snapmaker U1 (0.4 nozzle).json"
    doc = json.loads(leaf.read_text(encoding="utf-8"))
    doc["layer_height"] = "0.25"
    leaf.write_text(json.dumps(doc), encoding="utf-8")

    after = seed_snapmaker_u1_slicer_profiles(conn, profiles_dir)

    assert len(conn.rows) == 3
    assert before["process"] == after["process"]  # тот же id, не новая строка
    assert conn.rows[("orcaslicer", "test-process-id")]["content_hash"] != before_hash


def test_seed_raises_on_missing_bundle(tmp_path):
    with pytest.raises(SnapmakerProfileError):
        seed_snapmaker_u1_slicer_profiles(FakeConn(), tmp_path)


def test_normalize_process_params_maps_unified_keys(tmp_path):
    profiles_dir = _seed_synthetic_vendor(tmp_path)
    profile = resolve_snapmaker_u1_profile(profiles_dir)

    params = _normalize_process_or_filament_params("process", profile.process)
    assert params["layer_height_mm"] == 0.2
    assert params["infill_density_pct"] == 15.0
    assert params["wall_loops"] == 2


def test_normalize_filament_params_maps_unified_keys(tmp_path):
    profiles_dir = _seed_synthetic_vendor(tmp_path)
    profile = resolve_snapmaker_u1_profile(profiles_dir)

    params = _normalize_process_or_filament_params("filament", profile.filament)
    assert params["nozzle_temperature_c"]["other"] == 210.0
    assert params["bed_temperature_c"]["other"] == 55.0


def test_normalize_machine_params_includes_build_volume(tmp_path):
    profiles_dir = _seed_synthetic_vendor(tmp_path)
    profile = resolve_snapmaker_u1_profile(profiles_dir)

    params = _normalize_machine_params(profile)
    assert params["build_volume_mm"] == {"x": 270.0, "y": 270.0, "z": 270.05}
    assert params["nozzle_diameter_mm"] == 0.4
    assert params["gcode_flavor"] == "klipper"
