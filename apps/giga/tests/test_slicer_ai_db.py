"""Юнит-тесты `giga.slicer_ai.db` на фейковом connection/cursor — паттерн
`tests/test_calendar_db.py`, без реального Postgres."""

from __future__ import annotations

from giga.slicer_ai import db


class FakeCursor:
    def __init__(self, rows_by_marker):
        self._rows_by_marker = rows_by_marker
        self._result = None

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def execute(self, sql, params=()):
        text = " ".join(sql.split())
        for marker, result in self._rows_by_marker.items():
            if marker in text:
                self._result = result
                return
        raise AssertionError(f"unexpected SQL: {text}")

    def fetchone(self):
        return self._result

    def fetchall(self):
        return self._result


class FakeConn:
    def __init__(self, rows_by_marker):
        self._rows_by_marker = rows_by_marker

    def cursor(self):
        return FakeCursor(self._rows_by_marker)


def test_fetch_printer_maps_specs_with_fallback_paths():
    conn = FakeConn(
        {
            "select id, specs from machines": (
                "printer-1",
                {
                    "nozzle_diameter_mm": 0.4,
                    "kinematics": "CoreXY",
                    "build_volume_mm": {"x": 256, "y": 256, "z": 256},
                    "max_hotend_temp_c": 300,
                    "bed": {"max_temp_c": 110},
                    "max_speed_mm_s": 500,
                },
            )
        }
    )

    printer = db.fetch_printer(conn, "printer-1")

    assert printer is not None
    assert printer.id == "printer-1"
    assert printer.kinematics == "corexy" or printer.kinematics == "CoreXY"
    assert printer.max_nozzle_temp_c == 300
    assert printer.max_bed_temp_c == 110
    assert printer.max_print_speed_mm_s == 500
    assert printer.build_volume_mm == {"x": 256, "y": 256, "z": 256}


def test_fetch_printer_missing_returns_none():
    conn = FakeConn({"select id, specs from machines": None})
    assert db.fetch_printer(conn, "unknown") is None


def test_fetch_filament_maps_material_class():
    conn = FakeConn({"select m.id, mt.slug": ("filament-1", "pla", {"diameter_mm": 1.75})})

    filament = db.fetch_filament(conn, "filament-1")

    assert filament is not None
    assert filament.material_class == "pla"
    assert filament.diameter_mm == 1.75


def test_fetch_active_profiles_maps_rows():
    conn = FakeConn(
        {
            "select id, profile_class, slicer, name": [
                (
                    "profile-1",
                    "process",
                    "orcaslicer",
                    "CoreXY PLA 0.20",
                    None,
                    "printer-1",
                    None,
                    {"print_speed_mm_s": 200},
                    "OrcaSlicer",
                    None,
                    "profiles/x.json",
                    "AGPL-3.0-or-later",
                    "1.00",
                    None,
                )
            ]
        }
    )

    profiles = db.fetch_active_profiles(conn)

    assert len(profiles) == 1
    assert profiles[0].id == "profile-1"
    assert profiles[0].confidence == 1.0
    assert profiles[0].params == {"print_speed_mm_s": 200}


def test_calibration_signal_available_false_when_table_missing():
    conn = FakeConn({"select to_regclass": (False,)})
    assert db.calibration_signal_available(conn) is False


def test_calibration_signal_available_true_when_table_exists():
    conn = FakeConn({"select to_regclass": (True,)})
    assert db.calibration_signal_available(conn) is True


def test_fetch_calibration_summary_none_when_no_rows():
    conn = FakeConn({"select count(*) filter": (0, 0, None, None)})
    assert db.fetch_calibration_summary(conn, "machine-1", "material-1") is None


def test_fetch_calibration_summary_aggregates_success_and_defect():
    conn = FakeConn({"select count(*) filter": (8, 2, 0.97, 0.045)})

    summary = db.fetch_calibration_summary(conn, "machine-1", "material-1")

    assert summary is not None
    assert summary.sample_count == 10
    assert summary.success_count == 8
    assert summary.defect_count == 2
    assert summary.success_rate == 0.8
    assert summary.avg_flow_ratio == 0.97
    assert summary.avg_pressure_advance == 0.045
