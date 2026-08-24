"""Юнит-тесты парсинга результата OrcaSlicer (MF-1974) — без реального бинаря,
на синтетических `.3mf`-архивах (та же форма `Metadata/plate_1.gcode`/
`Metadata/slice_info.config`, что реальный живой прогон, см.
`test_snapmaker_u1_slice.py` для проверки живым бинарём)."""

import io
import zipfile

import pytest

from mesh.slicer_engine import (
    OrcaSliceMetrics,
    SlicerEngineConfig,
    SlicingError,
    _extract_orca_plate_slice_result,
    _extract_orca_slice_result,
    _orca_slice_cmd,
    _parse_layer_count,
    _parse_orca_slice_info,
    load_orca_engine_config,
)

_REAL_SLICE_INFO = """<?xml version="1.0" encoding="UTF-8"?>
<config>
  <plate>
    <metadata key="prediction" value="39379"/>
    <metadata key="weight" value="302.27"/>
    <object identify_id="14" name="part.stl_id_0_copy_0" skipped="false" />
    <filament id="1" type="PLA" used_m="101.35" used_g="302.27" />
  </plate>
</config>
"""

_PLATE_SLICE_INFO = """<?xml version="1.0" encoding="UTF-8"?>
<config>
  <plate>
    <metadata key="prediction" value="1000"/>
    <metadata key="weight" value="20.0"/>
    <object identify_id="1" name="instance-a" skipped="false" />
    <object identify_id="2" name="instance-b" skipped="true" />
    <filament id="1" type="PLA" used_m="10.0" used_g="20.0" />
  </plate>
</config>
"""


def _make_3mf(*, gcode_names=("Metadata/plate_1.gcode",), slice_info=_REAL_SLICE_INFO) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as archive:
        for name in gcode_names:
            archive.writestr(name, "; HEADER_BLOCK_START\nG28\n")
        if slice_info is not None:
            archive.writestr("Metadata/slice_info.config", slice_info)
    return buf.getvalue()


def test_parse_orca_slice_info_extracts_real_metrics():
    metrics = _parse_orca_slice_info(_REAL_SLICE_INFO)
    assert metrics == OrcaSliceMetrics(
        print_time_seconds=39379.0, filament_used_g=302.27, filament_used_m=101.35, warnings=()
    )


def test_parse_orca_slice_info_flags_skipped_object_as_warning():
    xml = _REAL_SLICE_INFO.replace('skipped="false"', 'skipped="true"')
    metrics = _parse_orca_slice_info(xml)
    assert len(metrics.warnings) == 1
    assert "пропущен" in metrics.warnings[0]


def test_parse_orca_slice_info_rejects_missing_plate():
    with pytest.raises(SlicingError):
        _parse_orca_slice_info("<config></config>")


def test_parse_orca_slice_info_rejects_missing_filament():
    xml = """<config><plate><metadata key="prediction" value="10"/></plate></config>"""
    with pytest.raises(SlicingError):
        _parse_orca_slice_info(xml)


def test_parse_orca_slice_info_rejects_unparseable_prediction():
    xml = _REAL_SLICE_INFO.replace('value="39379"', 'value="n/a"')
    with pytest.raises(SlicingError):
        _parse_orca_slice_info(xml)


def test_parse_orca_slice_info_rejects_invalid_xml():
    with pytest.raises(SlicingError):
        _parse_orca_slice_info("<config><plate>")


def test_extract_orca_slice_result_writes_gcode_and_parses_metrics(tmp_path):
    zip_path = tmp_path / "sliced.3mf"
    zip_path.write_bytes(_make_3mf())
    output_gcode = tmp_path / "out.gcode"

    metrics = _extract_orca_slice_result(zip_path, output_gcode)

    assert output_gcode.is_file()
    assert output_gcode.read_text().startswith("; HEADER_BLOCK_START")
    assert metrics.print_time_seconds == 39379.0


def test_extract_orca_slice_result_rejects_missing_gcode(tmp_path):
    zip_path = tmp_path / "sliced.3mf"
    zip_path.write_bytes(_make_3mf(gcode_names=()))
    with pytest.raises(SlicingError):
        _extract_orca_slice_result(zip_path, tmp_path / "out.gcode")


def test_extract_orca_slice_result_rejects_multi_plate(tmp_path):
    zip_path = tmp_path / "sliced.3mf"
    zip_path.write_bytes(
        _make_3mf(gcode_names=("Metadata/plate_1.gcode", "Metadata/plate_2.gcode"))
    )
    with pytest.raises(SlicingError):
        _extract_orca_slice_result(zip_path, tmp_path / "out.gcode")


def test_extract_orca_slice_result_rejects_missing_slice_info(tmp_path):
    zip_path = tmp_path / "sliced.3mf"
    zip_path.write_bytes(_make_3mf(slice_info=None))
    with pytest.raises(SlicingError):
        _extract_orca_slice_result(zip_path, tmp_path / "out.gcode")


def test_load_orca_engine_config_returns_none_without_binary(monkeypatch):
    monkeypatch.delenv("SLICER_ORCA_BINARY_PATH", raising=False)
    assert load_orca_engine_config() is None


def test_load_orca_engine_config_reads_env(monkeypatch):
    monkeypatch.setenv("SLICER_ORCA_BINARY_PATH", "/opt/orca/orca-slicer")
    monkeypatch.setenv("SLICER_ORCA_MEMORY_MAX_MB", "4096")
    config = load_orca_engine_config()
    assert config == SlicerEngineConfig(
        binary_path="/opt/orca/orca-slicer",
        cpu_quota_percent=150,
        memory_max_mb=4096,
        tasks_max=16,
        timeout_seconds=600,
    )


## Мульти-инстанс плита (MF-1987, project-slice-request.v1)


def test_orca_slice_cmd_defaults_to_arrange_and_ensure_on_bed():
    cmd = _orca_slice_cmd("orca", "p.json", "pr.json", "f.json", "in.stl", "out.3mf")
    assert "--arrange" in cmd and cmd[cmd.index("--arrange") + 1] == "1"
    assert "--ensure-on-bed" in cmd


def test_orca_slice_cmd_disables_arrange_for_plate_layout():
    cmd = _orca_slice_cmd(
        "orca", "p.json", "pr.json", "f.json", "in.3mf", "out.3mf", arrange=False
    )
    assert "--arrange" in cmd and cmd[cmd.index("--arrange") + 1] == "0"
    assert "--ensure-on-bed" not in cmd


def test_parse_layer_count_from_vendor_header():
    gcode = b"; HEADER_BLOCK_START\n; total layer number: 123\nG28\n"
    assert _parse_layer_count(gcode) == 123


def test_parse_layer_count_falls_back_to_layer_change_markers():
    gcode = b"G28\n;LAYER_CHANGE\nG1\n;LAYER_CHANGE\nG1\n;LAYER_CHANGE\nG1\n"
    assert _parse_layer_count(gcode) == 3


def test_parse_layer_count_rejects_unknown_format():
    with pytest.raises(SlicingError):
        _parse_layer_count(b"G28\nG1 X1\n")


def _make_plate_3mf(*, slice_info=_PLATE_SLICE_INFO) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as archive:
        archive.writestr(
            "Metadata/plate_1.gcode",
            "; HEADER_BLOCK_START\n; total layer number: 42\nG28\n",
        )
        archive.writestr("Metadata/slice_info.config", slice_info)
    return buf.getvalue()


def test_extract_orca_plate_slice_result_matches_objects_by_name(tmp_path):
    zip_path = tmp_path / "plate.3mf"
    zip_path.write_bytes(_make_plate_3mf())
    output_gcode = tmp_path / "out.gcode"

    result = _extract_orca_plate_slice_result(zip_path, output_gcode)

    assert output_gcode.is_file()
    assert result.metrics.print_time_seconds == 1000.0
    assert result.layer_count == 42
    names = {obj.name: obj.skipped for obj in result.objects}
    assert names == {"instance-a": False, "instance-b": True}


def test_run_orcaslicer_wraps_in_systemd_run_scope(monkeypatch, tmp_path):
    """Продовый путь ДОЛЖЕН идти через systemd-run cgroup-обёртку (тот же
    контракт, что `run_prusaslicer`) — здесь без реального бинаря/dbus-сессии
    (см. `slice_with_orca_cli` для живого прогона), проверяем только форму
    команды."""
    import mesh.slicer_engine as engine

    captured = {}

    def fake_run(cmd, **kwargs):
        captured["cmd"] = cmd
        out_3mf = None
        for i, arg in enumerate(cmd):
            if arg == "--export-3mf":
                out_3mf = cmd[i + 1]
        from pathlib import Path

        Path(out_3mf).write_bytes(
            _make_3mf()
        )

        class Result:
            returncode = 0
            stderr = ""
            stdout = ""

        return Result()

    monkeypatch.setattr(engine.subprocess, "run", fake_run)

    config = SlicerEngineConfig(
        binary_path="/opt/orca/orca-slicer",
        cpu_quota_percent=150,
        memory_max_mb=2048,
        tasks_max=16,
        timeout_seconds=600,
    )
    output_gcode = tmp_path / "out.gcode"
    metrics = engine.run_orcaslicer(config, tmp_path / "part.stl", {}, {}, {}, output_gcode)

    assert captured["cmd"][:3] == ["systemd-run", "--user", "--scope"]
    assert "/opt/orca/orca-slicer" in captured["cmd"]
    assert output_gcode.is_file()
    assert metrics.print_time_seconds == 39379.0
