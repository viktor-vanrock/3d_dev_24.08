"""Оркестрация headless-слайса под Snapmaker U1 (MF-1974): preflight → реальный
`orca-slicer` → метрики.

Единая точка входа, которую можно дёрнуть и из теста на корпусе SO-ARM100
(см. `tests/test_snapmaker_u1_slice.py`), и из DB-driven диспетчера
`slicing_queue.py` (связка сделана MF-1987 — см. докстринг `slicer_engine.py`
§ «OrcaSlicer headless-слайс» про исходно недостающую связку `slice_jobs`↔
machine-геометрия). Preflight ВСЕГДА проходит первым — ни один вызов
`run_orcaslicer` не должен случиться на детали, которая физически не может
быть напечатана (другой toolhead, деталь больше стола, протухший профиль).

## Мульти-инстанс плита (MF-1987, project-slice-request.v1)

`slice_snapmaker_u1_plate` — несколько инстансов ОДНОГО пиненного project
artifact на одной плите U1 (`PlateLayout`/`PlateInstance`, решение MF-1981):
per-instance toolhead-гейт → per-instance geometry-preflight
(`slicer_preflight.check_plate_layout`) → сборка multi-object plate-3MF
(`build_plate_3mf`) → реальный `orca-slicer` с `arrange=False` (уже
провалидированная раскладка, Orca не должен её переписывать) → per-instance
разбивка результата для preview-манифеста (`slicing_queue.py` публикует
`slice-preview.v1`).
"""

from __future__ import annotations

import math
import tempfile
from dataclasses import dataclass
from pathlib import Path

import trimesh

from .limits import Limits, load_limits
from .slicer_engine import (
    OrcaSliceMetrics,
    SlicerEngineConfig,
    SlicingError,
    run_orcaslicer,
    run_orcaslicer_plate,
    slice_plate_with_orca_cli,
    slice_with_orca_cli,
)
from .slicer_preflight import (
    BoundingBoxMM,
    PlateInstanceGeometry,
    check_bed_fit,
    check_plate_layout,
    check_plate_toolheads,
    check_profile_hash,
    check_single_toolhead,
    check_units,
)
from .snapmaker_u1_profile import SUPPORTED_TOOLHEAD_INDEX, SnapmakerU1Profile
from .stl_reader import load_stl_mesh


@dataclass(frozen=True)
class SnapmakerU1SliceResult:
    gcode_path: Path
    metrics: OrcaSliceMetrics
    profile_content_hash: str


def slice_snapmaker_u1(
    engine_config: SlicerEngineConfig,
    profile: SnapmakerU1Profile,
    stl_path: Path,
    bbox_mm: BoundingBoxMM,
    output_gcode: Path,
    *,
    unit: str = "mm",
    toolhead_index: int = SUPPORTED_TOOLHEAD_INDEX,
    expected_profile_hash: str | None = None,
    clearance_mm: float = 0.0,
    use_cgroup: bool = True,
) -> SnapmakerU1SliceResult:
    """Preflight (`slicer_preflight`) → реальный `orca-slicer`. Любой
    `PreflightError`/`SlicingError` пробрасывается вызывающему коду как есть —
    воркер (`slicing_queue.py`) обязан ловить их и переводить джобу в
    `failed`, не выдавать ложный `ready` (см. акцептанс-критерий карточки).

    `use_cgroup=False` — прямой вызов `orca-slicer` без `systemd-run`
    (`slice_with_orca_cli`, см. её докстринг): используется живыми тестами в
    окружении без пользовательской systemd/dbus-сессии. Продовый путь
    (`use_cgroup=True`, дефолт) — cgroup-обёрнутый `run_orcaslicer`.
    """
    check_units(unit)
    check_single_toolhead(toolhead_index)
    if expected_profile_hash is not None:
        check_profile_hash(expected_profile_hash, profile.content_hash)
    check_bed_fit(bbox_mm, profile.build_volume_mm, clearance_mm=clearance_mm)

    if use_cgroup:
        metrics = run_orcaslicer(
            engine_config, stl_path, profile.printer, profile.process, profile.filament,
            output_gcode,
        )
    else:
        metrics = slice_with_orca_cli(
            engine_config.binary_path, stl_path, profile.printer, profile.process,
            profile.filament, output_gcode, timeout_seconds=engine_config.timeout_seconds,
        )
    return SnapmakerU1SliceResult(
        gcode_path=output_gcode, metrics=metrics, profile_content_hash=profile.content_hash
    )


@dataclass(frozen=True)
class PlateInstanceInput:
    """Один инстанс плиты, готовый к слайсу: `stl_path` — уже скачанные Mesh
    байты пиненного artifact (Back резолвит/стейджит, Mesh не резолвит git
    сам — см. докстринг карточки MF-1987), остальное — layout `PlateInstance`
    контракта. `x_mm`/`y_mm` — положение ЦЕНТРА footprint инстанса на плите,
    начало координат — угол стола (тот же угол-origin, что
    `snapmaker_u1_profile.build_volume_mm`/`slicer_preflight.check_bed_fit`)."""

    instance_id: str
    stl_path: Path
    x_mm: float
    y_mm: float
    rotation_z_deg: float
    scale: float = 1.0
    toolhead_index: int = 0


@dataclass(frozen=True)
class InstancePlateSummary:
    """Per-instance запись preview-манифеста `slice-preview.v1`
    (`slicing_queue.py` — точный конверт, обоснование полей в докстринге
    карточки MF-1987)."""

    instance_id: str
    footprint_mm: dict[str, float]
    supports_used: bool
    layer_count: int
    skipped: bool


@dataclass(frozen=True)
class SnapmakerU1PlateSliceResult:
    gcode_path: Path
    metrics: OrcaSliceMetrics
    profile_content_hash: str
    instances: tuple[InstancePlateSummary, ...]


def build_plate_3mf(
    loaded: list[tuple[PlateInstanceInput, trimesh.Trimesh]], output_3mf: Path
) -> None:
    """Собирает один multi-object 3MF плиты: каждый инстанс — отдельный
    `<object>`, поимённо совпадающий с `instance_id` (Orca переносит имя в
    `slice_info.config`, см. `slicer_engine._extract_orca_plate_slice_result`)
    — так per-instance метрики после слайса матчатся обратно без угадывания
    по порядку объектов.

    Порядок transform на инстанс — тот же, что `slicer_preflight.
    compute_placed_footprint` использует для preflight (обе стороны обязаны
    совпадать байт-в-байт, иначе preflight проверяет не ту раскладку, что
    реально режется): деталь сперва выравнивается на локальный центр XY и
    Z=0 (bottom-align — не полагаемся на недокументированное для
    `--arrange 0` поведение `--ensure-on-bed` у стороннего бинаря, см.
    докстринг `slicer_engine._orca_slice_cmd`), затем scale → поворот вокруг
    Z → перенос центра footprint в (x_mm, y_mm).
    """
    scene = trimesh.Scene()
    for instance, mesh in loaded:
        local = mesh.copy()
        lo, hi = local.bounds
        center_xy = (lo[:2] + hi[:2]) / 2.0
        local.apply_translation([-center_xy[0], -center_xy[1], -lo[2]])

        theta = math.radians(instance.rotation_z_deg)
        transform = (
            trimesh.transformations.translation_matrix([instance.x_mm, instance.y_mm, 0.0])
            @ trimesh.transformations.rotation_matrix(theta, [0.0, 0.0, 1.0])
            @ trimesh.transformations.scale_matrix(instance.scale)
        )
        scene.add_geometry(
            local,
            node_name=instance.instance_id,
            geom_name=instance.instance_id,
            transform=transform,
        )
    scene.export(output_3mf, file_type="3mf")


def slice_snapmaker_u1_plate(
    engine_config: SlicerEngineConfig,
    profile: SnapmakerU1Profile,
    instances: list[PlateInstanceInput],
    output_gcode: Path,
    *,
    unit: str = "mm",
    supports: str = "off",
    expected_profile_hash: str | None = None,
    clearance_mm: float = 0.0,
    use_cgroup: bool = True,
    limits: Limits | None = None,
) -> SnapmakerU1PlateSliceResult:
    """Мульти-инстанс вариант `slice_snapmaker_u1` (MF-1987, project-slice-
    request.v1): несколько копий ОДНОГО пиненного artifact на одной плите U1.

    Раскладка (`x_mm`/`y_mm`/`rotation_z_deg`/`scale`) уже провалидирована
    Back-стороной контракта на API-preflight, но Mesh обязан перепроверить
    сам (принцип зоны: воркер не доверяет входу вслепую, см. CLAUDE.md
    «Вход враждебен») — per-instance toolhead ДО geometry-preflight ДО
    реального слайса, тот же порядок приоритета, что `slice_snapmaker_u1`.
    Любой `UnsupportedToolheadError`/`PlateLayoutError`/`SlicingError`
    пробрасывается вызывающему коду как есть — `slicing_queue.py` обязан
    поймать их и завести джобу в `failed` с соответствующим `error_code`.
    """
    check_units(unit)
    if not instances:
        raise SlicingError("плита без инстансов — нечего слайсить")
    if expected_profile_hash is not None:
        check_profile_hash(expected_profile_hash, profile.content_hash)

    # Toolhead — дешёвый hard-gate ДО загрузки геометрии (см. `check_plate_toolheads`
    # докстринг): `PlateInstanceInput` несёт те же `instance_id`/`toolhead_index`
    # поля, что и `PlateInstanceGeometry`, дублировать dataclass здесь незачем.
    check_plate_toolheads(instances)

    limits = limits or load_limits()
    loaded: list[tuple[PlateInstanceInput, trimesh.Trimesh]] = []
    geometries: list[PlateInstanceGeometry] = []
    for instance in instances:
        mesh = load_stl_mesh(instance.stl_path, limits)
        lo, hi = mesh.bounds
        size = hi - lo
        local_bbox = BoundingBoxMM(x=float(size[0]), y=float(size[1]), z=float(size[2]))
        loaded.append((instance, mesh))
        geometries.append(
            PlateInstanceGeometry(
                instance_id=instance.instance_id,
                local_bbox=local_bbox,
                x_mm=instance.x_mm,
                y_mm=instance.y_mm,
                rotation_z_deg=instance.rotation_z_deg,
                scale=instance.scale,
                toolhead_index=instance.toolhead_index,
            )
        )

    footprints = check_plate_layout(geometries, profile.build_volume_mm, clearance_mm=clearance_mm)

    with tempfile.TemporaryDirectory(prefix="mesh-plate-3mf-") as tmp:
        plate_3mf = Path(tmp) / "plate.3mf"
        build_plate_3mf(loaded, plate_3mf)

        if use_cgroup:
            plate_result = run_orcaslicer_plate(
                engine_config, plate_3mf, profile.printer, profile.process, profile.filament,
                output_gcode,
            )
        else:
            plate_result = slice_plate_with_orca_cli(
                engine_config.binary_path, plate_3mf, profile.printer, profile.process,
                profile.filament, output_gcode, timeout_seconds=engine_config.timeout_seconds,
            )

    skipped_names = {obj.name for obj in plate_result.objects if obj.skipped}
    summaries = tuple(
        InstancePlateSummary(
            instance_id=instance.instance_id,
            footprint_mm={
                "x": round(footprints[instance.instance_id].size_x, 3),
                "y": round(footprints[instance.instance_id].size_y, 3),
                "z": round(footprints[instance.instance_id].height_mm, 3),
            },
            # Per-object support-детекция потребовала бы разбора toolpath
            # g-code на маркеры support-структур — вне MVP этой карточки;
            # honest signal — заявленный intent на всю плиту (per-instance
            # override supports этот контракт не несёт, см. решение MF-1981).
            supports_used=supports != "off",
            layer_count=plate_result.layer_count,
            skipped=instance.instance_id in skipped_names,
        )
        for instance in instances
    )
    return SnapmakerU1PlateSliceResult(
        gcode_path=output_gcode,
        metrics=plate_result.metrics,
        profile_content_hash=profile.content_hash,
        instances=summaries,
    )
