"""Живой headless-слайс Snapmaker U1 на реальном корпусе SO-ARM100 (MF-1974).

Три вещи, которые «Готово когда» карточки требует проверять реальным
прогоном, не догадкой:
- acceptance-артефакты из пиненного коммита SO-ARM100 (порядок зафиксирован
  оператором в карточке, 2026-07-19: `gauge_loose` → `gauge_tight` →
  `follower_plate`, см. `so101_corpus.py` и `docs/product/project.as.code.md`
  § «Печатный шаг и слайсер») реально режутся `orca-slicer` под резолвленным
  профилем Snapmaker U1;
- результат несёт G-code + честные метрики (время печати/расход филамента);
- collision/out-of-bed на реальной геометрии отклоняется preflight ДО вызова
  слайсера (а не тихо режется мимо стола).

Пропускается без `MESH_ORCA_SLICER_BIN`/`MESH_ORCA_PROFILES_DIR` (тот же
паттерн `skipif`, что `test_slicer_ci_validate.py`) или без сети (внешний
пиненный коммит GitHub, см. `so101_corpus.py`).
"""

from __future__ import annotations

import os
from pathlib import Path

import pytest
import so101_corpus

from mesh.limits import load_limits
from mesh.slicer_engine import SlicerEngineConfig, SlicingError
from mesh.slicer_preflight import (
    BoundingBoxMM,
    PlateLayoutError,
    PreflightError,
    UnsupportedToolheadError,
    check_bed_fit,
)
from mesh.snapmaker_u1_profile import SnapmakerU1Profile, resolve_snapmaker_u1_profile
from mesh.snapmaker_u1_slice import (
    PlateInstanceInput,
    build_plate_3mf,
    slice_snapmaker_u1,
    slice_snapmaker_u1_plate,
)
from mesh.stl_reader import load_stl_mesh

_orca_bin = os.getenv("MESH_ORCA_SLICER_BIN")
_profiles_dir = os.getenv("MESH_ORCA_PROFILES_DIR")
_SKIP_REASON = (
    "MESH_ORCA_SLICER_BIN/MESH_ORCA_PROFILES_DIR не заданы — headless Orca недоступен"
)


def _engine_config(binary_path: str) -> SlicerEngineConfig:
    return SlicerEngineConfig(
        binary_path=binary_path,
        cpu_quota_percent=150,
        memory_max_mb=2048,
        tasks_max=16,
        timeout_seconds=180,
    )


def _bbox_from_stl(path: Path) -> BoundingBoxMM:
    mesh = load_stl_mesh(path, load_limits())
    lo, hi = mesh.bounds
    size = hi - lo
    return BoundingBoxMM(x=float(size[0]), y=float(size[1]), z=float(size[2]))


def _fetch_or_skip(name: str, tmp_path: Path) -> Path:
    try:
        return so101_corpus.fetch(name, tmp_path)
    except so101_corpus.So101FixtureUnavailable as exc:
        pytest.skip(f"корпус SO-101 недоступен: {exc}")


@pytest.mark.skipif(not (_orca_bin and _profiles_dir), reason=_SKIP_REASON)
@pytest.mark.parametrize("artifact_name", ["gauge_loose", "gauge_tight"])
def test_slice_so101_gauge_real_binary(tmp_path, artifact_name):
    """Первые acceptance-артефакты (оператор, MF-1974, 2026-07-19) — маленькие
    калибровочные шаблоны, дешёвый быстрый сигнал перед дорогой плитой."""
    stl_path = _fetch_or_skip(artifact_name, tmp_path)
    profile = resolve_snapmaker_u1_profile(Path(_profiles_dir))
    bbox = _bbox_from_stl(stl_path)

    output_gcode = tmp_path / f"{artifact_name}.gcode"
    result = slice_snapmaker_u1(
        _engine_config(_orca_bin), profile, stl_path, bbox, output_gcode, use_cgroup=False
    )

    assert result.gcode_path.is_file()
    assert result.metrics.print_time_seconds > 0
    assert result.metrics.filament_used_g > 0
    assert result.metrics.warnings == ()


@pytest.mark.skipif(not (_orca_bin and _profiles_dir), reason=_SKIP_REASON)
def test_slice_so101_follower_plate_real_binary(tmp_path):
    """Третий acceptance-артефакт (оператор, MF-1974, 2026-07-19):
    `STL/SO101/Follower/Ender_Follower_SO101.stl` — крупная плита после двух
    дешёвых gauge-проверок выше."""
    stl_path = _fetch_or_skip("follower_plate", tmp_path)
    profile = resolve_snapmaker_u1_profile(Path(_profiles_dir))
    bbox = _bbox_from_stl(stl_path)

    # Плита SO-101 (216×215мм) должна помещаться в стол U1 (270×270) без
    # всякого clearance-запаса.
    check_bed_fit(bbox, profile.build_volume_mm)

    output_gcode = tmp_path / "follower.gcode"
    result = slice_snapmaker_u1(
        _engine_config(_orca_bin), profile, stl_path, bbox, output_gcode, use_cgroup=False
    )

    assert result.gcode_path.is_file()
    assert result.gcode_path.stat().st_size > 10_000
    gcode_head = result.gcode_path.read_text(encoding="utf-8", errors="replace")[:200]
    assert "OrcaSlicer" in gcode_head

    # Реальные метрики — не выдуманные, посчитаны Orca по факту toolpath.
    assert result.metrics.print_time_seconds > 0
    assert result.metrics.filament_used_g > 0
    assert result.metrics.filament_used_m > 0
    assert result.metrics.warnings == ()
    assert len(result.profile_content_hash) == 64


@pytest.mark.skipif(not (_orca_bin and _profiles_dir), reason=_SKIP_REASON)
def test_slice_rejects_out_of_bed_part_before_calling_slicer(tmp_path):
    """300мм-куб физически не влезает в стол 270×270×270 U1 — preflight должен
    отказать ДО запуска слайсера (дешёвый структурированный отказ, не сырой
    `stderr` внешнего бинаря)."""
    trimesh = pytest.importorskip("trimesh")
    stl_path = tmp_path / "oversize.stl"
    trimesh.creation.box(extents=[300.0, 100.0, 50.0]).export(stl_path)

    profile = resolve_snapmaker_u1_profile(Path(_profiles_dir))
    bbox = _bbox_from_stl(stl_path)

    output_gcode = tmp_path / "oversize.gcode"
    with pytest.raises(PreflightError) as exc:
        slice_snapmaker_u1(
            _engine_config(_orca_bin), profile, stl_path, bbox, output_gcode, use_cgroup=False
        )
    assert exc.value.code == "OUT_OF_BED"
    assert not output_gcode.exists()


@pytest.mark.skipif(not (_orca_bin and _profiles_dir), reason=_SKIP_REASON)
def test_orcaslicer_itself_also_rejects_out_of_bed_part(tmp_path):
    """Двойная проверка реального поведения слайсера (не только нашего
    preflight) — прогон живым бинарём без preflight должен дать честный
    ненулевой exit, не тихий "успех" с деталью частично вне стола."""
    trimesh = pytest.importorskip("trimesh")
    stl_path = tmp_path / "oversize.stl"
    trimesh.creation.box(extents=[300.0, 100.0, 50.0]).export(stl_path)

    profile = resolve_snapmaker_u1_profile(Path(_profiles_dir))
    output_gcode = tmp_path / "oversize.gcode"

    from mesh.slicer_engine import slice_with_orca_cli

    with pytest.raises(SlicingError):
        slice_with_orca_cli(
            _orca_bin,
            stl_path,
            profile.printer,
            profile.process,
            profile.filament,
            output_gcode,
        )
    assert not output_gcode.exists()


## Мульти-инстанс плита (MF-1987, project-slice-request.v1) — сборка 3MF и
## per-instance гейты не требуют живого бинаря/вендорского бандла, поэтому
## идут отдельно от skipif-гейта выше (быстрый сигнал в обычном CI).


def _fake_u1_profile() -> SnapmakerU1Profile:
    """Синтетический профиль с реальной геометрией паспорта U1 (270×270×270.05,
    см. `snapmaker_u1_profile.EXPECTED_BUILD_VOLUME_MM`) — печатный/материальный
    словарь не нужен тестам, которые не доходят до реального вызова orca-slicer."""
    return SnapmakerU1Profile(
        printer={
            "printable_area": ["0x0", "270x0", "270x270", "0x270"],
            "printable_height": 270.05,
        },
        process={},
        filament={},
        content_hash="0" * 64,
        source_name="test",
        source_url="",
        source_ref="",
        source_version="test",
        license="test",
    )


def test_build_plate_3mf_names_objects_by_instance_id(tmp_path):
    trimesh = pytest.importorskip("trimesh")
    stl_path = tmp_path / "box.stl"
    trimesh.creation.box(extents=[10.0, 10.0, 10.0]).export(stl_path)
    mesh_a = trimesh.load_mesh(stl_path)
    mesh_b = trimesh.load_mesh(stl_path)

    inst_a = PlateInstanceInput(
        instance_id="inst-a", stl_path=stl_path, x_mm=50.0, y_mm=50.0, rotation_z_deg=0.0
    )
    inst_b = PlateInstanceInput(
        instance_id="inst-b", stl_path=stl_path, x_mm=120.0, y_mm=50.0, rotation_z_deg=90.0
    )

    output_3mf = tmp_path / "plate.3mf"
    build_plate_3mf([(inst_a, mesh_a), (inst_b, mesh_b)], output_3mf)

    import zipfile

    with zipfile.ZipFile(output_3mf) as archive:
        model_xml = archive.read("3D/3dmodel.model").decode("utf-8")
    assert 'name="inst-a"' in model_xml
    assert 'name="inst-b"' in model_xml
    assert 'partnumber="inst-a"' in model_xml
    assert 'partnumber="inst-b"' in model_xml


def test_slice_snapmaker_u1_plate_rejects_mismatched_toolhead_before_engine(tmp_path, monkeypatch):
    """Job с инстансами на разных toolhead одного U1 отказывает
    `UNSUPPORTED_TOOLHEAD` ДО любого обращения к слайсеру (см. карточку
    MF-1987 § «Toolhead-граница... по инстансу»)."""
    import mesh.snapmaker_u1_slice as plate_module

    called = []
    monkeypatch.setattr(
        plate_module, "run_orcaslicer_plate", lambda *a, **k: called.append(True)
    )
    monkeypatch.setattr(
        plate_module, "slice_plate_with_orca_cli", lambda *a, **k: called.append(True)
    )

    stl_path = tmp_path / "box.stl"
    pytest.importorskip("trimesh").creation.box(extents=[10.0, 10.0, 10.0]).export(stl_path)

    instances = [
        PlateInstanceInput(
            instance_id="a", stl_path=stl_path, x_mm=50.0, y_mm=50.0, rotation_z_deg=0.0,
            toolhead_index=0,
        ),
        PlateInstanceInput(
            instance_id="b", stl_path=stl_path, x_mm=100.0, y_mm=50.0, rotation_z_deg=0.0,
            toolhead_index=1,
        ),
    ]

    with pytest.raises(UnsupportedToolheadError) as exc:
        slice_snapmaker_u1_plate(
            _engine_config("orca"), _fake_u1_profile(), instances, tmp_path / "out.gcode"
        )
    assert exc.value.instance_ids == ["b"]
    assert called == []


def test_slice_snapmaker_u1_plate_rejects_colliding_layout_before_engine(tmp_path, monkeypatch):
    """Пересекающаяся раскладка отклоняется geometry-preflight'ом ДО вызова
    orca-slicer — дешёвый структурированный отказ, не сырой stderr движка."""
    import mesh.snapmaker_u1_slice as plate_module

    called = []
    monkeypatch.setattr(
        plate_module, "run_orcaslicer_plate", lambda *a, **k: called.append(True)
    )

    stl_path = tmp_path / "box.stl"
    pytest.importorskip("trimesh").creation.box(extents=[10.0, 10.0, 10.0]).export(stl_path)

    instances = [
        PlateInstanceInput(
            instance_id="a", stl_path=stl_path, x_mm=50.0, y_mm=50.0, rotation_z_deg=0.0
        ),
        PlateInstanceInput(
            instance_id="b", stl_path=stl_path, x_mm=52.0, y_mm=50.0, rotation_z_deg=0.0
        ),
    ]

    with pytest.raises(PlateLayoutError) as exc:
        slice_snapmaker_u1_plate(
            _engine_config("orca"), _fake_u1_profile(), instances, tmp_path / "out.gcode"
        )
    assert {v.code for v in exc.value.violations} == {"collision"}
    assert called == []


@pytest.mark.skipif(not (_orca_bin and _profiles_dir), reason=_SKIP_REASON)
def test_slice_so101_plate_multi_instance_real_binary(tmp_path):
    """Готово-критерий MF-1987: multi-instance layout ОДНОГО пиненного
    SO-ARM100 artifact реально режется на реальный g-code с >1 инстансом на
    плите U1 (единый toolhead) — не standalone-вызов одного объекта."""
    stl_path = _fetch_or_skip("gauge_loose", tmp_path)
    profile = resolve_snapmaker_u1_profile(Path(_profiles_dir))

    instances = [
        PlateInstanceInput(
            instance_id="copy-1", stl_path=stl_path, x_mm=80.0, y_mm=135.0, rotation_z_deg=0.0
        ),
        PlateInstanceInput(
            instance_id="copy-2", stl_path=stl_path, x_mm=180.0, y_mm=135.0, rotation_z_deg=30.0
        ),
    ]

    output_gcode = tmp_path / "plate.gcode"
    result = slice_snapmaker_u1_plate(
        _engine_config(_orca_bin), profile, instances, output_gcode, use_cgroup=False
    )

    assert result.gcode_path.is_file()
    assert result.metrics.print_time_seconds > 0
    assert result.metrics.filament_used_g > 0
    assert {i.instance_id for i in result.instances} == {"copy-1", "copy-2"}
    for instance in result.instances:
        assert instance.layer_count > 0
        assert instance.footprint_mm["x"] > 0
        assert instance.footprint_mm["y"] > 0
