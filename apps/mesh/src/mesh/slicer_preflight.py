"""Preflight-проверки перед реальным headless-слайсом (MF-1974).

Вход враждебен (принцип зоны Mesh, CLAUDE.md): деталь может не помещаться в
стол, ссылаться на неподдержанный toolhead или прийти со сматченным профилем,
чьё содержимое с момента фиксации разошлось (гонка/повреждение кэша). Каждая
проверка здесь — быстрый, понятный отказ ДО запуска внешнего слайсера, а не
слайсер, зависший/упавший стектрейсом на заведомо непечатаемых данных.

`check_bed_fit`/`check_single_toolhead` подтверждены живым поведением реального
`orca-slicer` v2.4.2 (MF-1974): деталь 300×300×300мм под профилем Snapmaker U1
(стол 270×270×270) даёт реальный ненулевой exit `206` ("run found error") без
файла на диске — то есть Orca сам умеет отказать на collision, НО дожидаться
этого означает тратить процесс/cgroup слайсера на заведомо невозможную деталь и
парсить его stderr для понятной причины отказа. Preflight здесь дешевле и даёт
структурированный код ошибки для API/воркера (`slice_jobs.error`), а не сырой
`stderr` внешнего бинаря.
"""

from __future__ import annotations

import math
from dataclasses import dataclass


class PreflightError(Exception):
    """Деталь/профиль не прошли preflight — джоба должна стать `failed` с
    понятной причиной, слайсер вызывать не нужно."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


@dataclass(frozen=True)
class BoundingBoxMM:
    x: float
    y: float
    z: float


def check_finite_bbox(bbox: BoundingBoxMM) -> None:
    """Отклоняет NaN/Inf/неположительные размеры — вырожденная или повреждённая
    геометрия (сама деталь уже прошла защиту входа `mesh/stl_reader.py` на этапе
    конвертации; здесь — вторая, независимая проверка непосредственно перед
    слайсом, на случай, если bbox посчитан отдельно от каноничного 3MF)."""
    for axis, value in (("x", bbox.x), ("y", bbox.y), ("z", bbox.z)):
        if not math.isfinite(value) or value <= 0:
            raise PreflightError(
                "NON_FINITE_GEOMETRY", f"bbox.{axis}={value!r} — не конечный положительный размер"
            )


def check_units(unit: str, *, expected: str = "mm") -> None:
    """Конвейер 3mf.tech канонизирует длину в мм (`docs/architecture/project.manifest.md`
    § «Системы координат») — любой другой заявленный юнит на входе в слайс
    означает, что канонизация выше по пайплайну не отработала или была обойдена;
    честный отказ, а не тихая печать в неверном масштабе."""
    if unit != expected:
        raise PreflightError(
            "UNSUPPORTED_UNITS", f"единицы '{unit}' не поддержаны, ожидали '{expected}'"
        )


def check_bed_fit(
    bbox: BoundingBoxMM, build_volume_mm: dict[str, float], *, clearance_mm: float = 0.0
) -> None:
    """Деталь должна помещаться в объём печати станка с обеих сторон каждой оси
    (симметричный `clearance_mm` — запас на auto-arrange/edge-эффекты). Не
    заменяет проверку самого Orca (collision reale/multi-object packing) —
    дешёвый ранний отказ на заведомо невозможных случаях (деталь физически
    больше стола), см. докстринг модуля.
    """
    check_finite_bbox(bbox)
    for axis, value in (("x", bbox.x), ("y", bbox.y), ("z", bbox.z)):
        limit = build_volume_mm[axis] - 2 * clearance_mm
        if value > limit:
            raise PreflightError(
                "OUT_OF_BED",
                f"деталь не помещается по оси {axis}: {value:.2f}мм > "
                f"доступно {limit:.2f}мм (стол {build_volume_mm[axis]:.2f}мм, "
                f"clearance {clearance_mm:.2f}мм)",
            )


def check_single_toolhead(toolhead_index: int, *, supported: tuple[int, ...] = (0,)) -> None:
    """MVP SO-101 (MF-1974): U1 — реальный 4-toolhead toolchanger (Orca-профиль
    `fdm_U1` наследует `fdm_toolchanger`), но mapping деталь→toolhead этим шагом
    НЕ симулируется — явный отказ вместо угадывания, какой toolhead получит
    какой филамент. Печать разрешена только через toolhead `0` (single-material)."""
    if toolhead_index not in supported:
        raise PreflightError(
            "UNSUPPORTED_TOOLHEAD",
            f"toolhead {toolhead_index} не поддержан этим MVP (только {sorted(supported)}) — "
            "маппинг нескольких toolhead U1 не симулируется, см. docs/epics/slicer.profiles.md",
        )


#: `project-slice-request.v1` bed_geometry.origin (`packages/contracts/jobs/
#: slicer-plate.ts` BED_ORIGINS) — единственные значения, для которых
#: `_run_orca_plate_job` знает, как сдвинуть client-space координаты в
#: corner-space (MF-1994).
KNOWN_BED_ORIGINS = frozenset({"center", "front_left", "explicit"})


def check_bed_origin(origin: str | None) -> None:
    """`bed_geometry` отсутствует целиком (легаси job до MF-1987/MF-1992,
    без версионированной геометрии) — молчаливо трактуется как corner-space,
    сюда не попадает. Но если `bed_geometry` присутствует и несёт `origin`,
    это обязано быть одно из известных значений контракта — опечатка/будущее
    расширение enum'а без соответствующего сдвига в этом модуле означала бы
    угадывание системы координат вместо честного отказа (принцип зоны Mesh
    «вход враждебен»), см. MF-1994."""
    if origin is not None and origin not in KNOWN_BED_ORIGINS:
        raise PreflightError(
            "UNSUPPORTED_BED_ORIGIN",
            f"layout.bed_geometry.origin={origin!r} не поддержан — ожидали "
            f"{sorted(KNOWN_BED_ORIGINS)}",
        )


def check_profile_hash(expected_hash: str, actual_hash: str) -> None:
    """Профиль сматчен по хэшу заранее (например, на этапе рекомендации/UI) —
    если к моменту реального слайса вендорский бандл/резолвленный профиль
    изменился (апстрим-апдейт Orca, повреждённый кэш), слайсить чужой/устаревший
    набор настроек молча нельзя."""
    if expected_hash != actual_hash:
        raise PreflightError(
            "PROFILE_HASH_MISMATCH",
            f"профиль изменился с момента фиксации: ожидали {expected_hash}, "
            f"получили {actual_hash}",
        )


## Per-instance plate layout (MF-1987, project-slice-request.v1) — несколько
## инстансов ОДНОГО пиненного artifact на одной плите U1. Toolhead — отдельный
## hard-gate (`check_plate_toolheads`), не входит в `check_plate_layout`: два
## разных кода отказа, две разные оси контракта (см. решение MF-1981/карточка
## MF-1987 § «Toolhead-граница... по инстансу»).


@dataclass(frozen=True)
class PlateInstanceGeometry:
    """Один инстанс плиты: локальный (не трансформированный) bbox детали +
    layout-трансформация `PlateInstance` контракта. Порядок применения —
    scale → поворот вокруг Z → перенос центра footprint в (x_mm, y_mm), тот
    же порядок, что `snapmaker_u1_slice.build_plate_3mf` использует при
    реальной сборке plate-3MF (обе стороны обязаны совпадать байт-в-байт,
    иначе preflight проверяет не ту раскладку, что реально режется)."""

    instance_id: str
    local_bbox: BoundingBoxMM
    x_mm: float
    y_mm: float
    rotation_z_deg: float
    scale: float = 1.0
    toolhead_index: int = 0


@dataclass(frozen=True)
class PlacedFootprint:
    """Axis-aligned bbox инстанса на плите после трансформации — консервативная
    оценка (AABB после поворота, не точный минимальный прямоугольник), тот же
    принцип дешёвого раннего отказа, что `check_bed_fit` (не заменяет реальный
    packing/collision самого Orca)."""

    min_x: float
    min_y: float
    max_x: float
    max_y: float
    height_mm: float

    @property
    def size_x(self) -> float:
        return self.max_x - self.min_x

    @property
    def size_y(self) -> float:
        return self.max_y - self.min_y


@dataclass(frozen=True)
class PlateInstanceViolation:
    instance_id: str
    code: str
    message: str


class PlateLayoutError(Exception):
    """Один или несколько инстансов плиты не прошли geometry-preflight —
    вызывающий код (`slicing_queue.py`) обязан завести job в `failed` с
    `error_code=LAYOUT_PREFLIGHT_FAILED` и структурированным `PlatePreflightResult`
    (`violations`), не сырым stderr Orca."""

    def __init__(self, violations: list[PlateInstanceViolation]) -> None:
        self.violations = violations
        super().__init__(f"{len(violations)} нарушени(е/й) preflight плиты")


class UnsupportedToolheadError(Exception):
    """Один или несколько инстансов ссылаются на неподдержанный toolhead —
    отдельная ось от geometry-preflight (см. докстринг `check_single_toolhead`):
    `slicing_queue.py` обязан завести job в `failed` с `error_code=UNSUPPORTED_TOOLHEAD`,
    не тихо маппить на toolhead 0."""

    def __init__(self, instance_ids: list[str]) -> None:
        self.instance_ids = instance_ids
        super().__init__(f"неподдержанный toolhead у инстансов: {', '.join(instance_ids)}")


def check_plate_toolheads(
    instances: list[PlateInstanceGeometry], *, supported: tuple[int, ...] = (0,)
) -> None:
    """Per-instance toolhead-гейт плиты — собирает ВСЕ нарушения (не
    fail-fast на первом инстансе), чтобы отказ сразу называл все проблемные
    инстансы, не заставлял оператора чинить их по одному."""
    bad = [
        instance.instance_id for instance in instances if instance.toolhead_index not in supported
    ]
    if bad:
        raise UnsupportedToolheadError(bad)


def compute_placed_footprint(instance: PlateInstanceGeometry) -> PlacedFootprint:
    """AABB инстанса на плите после scale → поворот(Z) → перенос центра в
    (x_mm, y_mm). Поворот считается по угловым точкам локального (ещё не
    повёрнутого) bbox — консервативная оценка, см. докстринг `PlacedFootprint`."""
    check_finite_bbox(instance.local_bbox)
    if not math.isfinite(instance.scale) or instance.scale <= 0:
        raise PreflightError(
            "NON_FINITE_GEOMETRY",
            f"инстанс {instance.instance_id}: scale={instance.scale!r} — "
            "не конечный положительный размер",
        )
    half_x = instance.local_bbox.x * instance.scale / 2.0
    half_y = instance.local_bbox.y * instance.scale / 2.0
    theta = math.radians(instance.rotation_z_deg)
    cos_t, sin_t = math.cos(theta), math.sin(theta)
    corners = [(sx * half_x, sy * half_y) for sx in (-1.0, 1.0) for sy in (-1.0, 1.0)]
    rotated = [(x * cos_t - y * sin_t, x * sin_t + y * cos_t) for x, y in corners]
    xs = [instance.x_mm + x for x, _ in rotated]
    ys = [instance.y_mm + y for _, y in rotated]
    return PlacedFootprint(
        min_x=min(xs),
        min_y=min(ys),
        max_x=max(xs),
        max_y=max(ys),
        height_mm=instance.local_bbox.z * instance.scale,
    )


def check_plate_layout(
    instances: list[PlateInstanceGeometry],
    bed_geometry: dict[str, float],
    *,
    clearance_mm: float = 0.0,
) -> dict[str, PlacedFootprint]:
    """Per-instance geometry-preflight плиты: `collision|outside_bed|
    height_exceeded|clearance_failed|unsupported_geometry` (project-slice-request.v1,
    решение MF-1981/карточка MF-1987) — собирает ВСЕ нарушения сразу
    (`PlateLayoutError.violations`), не fail-fast на первом инстансе, так
    Back может вернуть клиенту полный `PlatePreflightResult` за один проход.

    Возвращает `{instance_id: PlacedFootprint}` при полном успехе — вызывающий
    код (`snapmaker_u1_slice.slice_snapmaker_u1_plate`) переиспользует эти
    footprint для `footprint_mm` в preview-манифесте, вместо пересчёта.
    """
    violations: list[PlateInstanceViolation] = []
    footprints: dict[str, PlacedFootprint] = {}
    for instance in instances:
        try:
            footprint = compute_placed_footprint(instance)
        except PreflightError as exc:
            violations.append(
                PlateInstanceViolation(instance.instance_id, "unsupported_geometry", str(exc))
            )
            continue
        footprints[instance.instance_id] = footprint

        if footprint.height_mm > bed_geometry["z"]:
            violations.append(
                PlateInstanceViolation(
                    instance.instance_id,
                    "height_exceeded",
                    f"высота {footprint.height_mm:.2f}мм > доступно {bed_geometry['z']:.2f}мм",
                )
            )
        limit_min_x = limit_min_y = clearance_mm
        limit_max_x = bed_geometry["x"] - clearance_mm
        limit_max_y = bed_geometry["y"] - clearance_mm
        if (
            footprint.min_x < limit_min_x
            or footprint.min_y < limit_min_y
            or footprint.max_x > limit_max_x
            or footprint.max_y > limit_max_y
        ):
            violations.append(
                PlateInstanceViolation(
                    instance.instance_id,
                    "outside_bed",
                    f"инстанс вне стола/зазора: [{footprint.min_x:.2f},{footprint.min_y:.2f}]"
                    f"..[{footprint.max_x:.2f},{footprint.max_y:.2f}]мм",
                )
            )

    ids = list(footprints.keys())
    for i in range(len(ids)):
        for j in range(i + 1, len(ids)):
            a, b = footprints[ids[i]], footprints[ids[j]]
            dx = max(b.min_x - a.max_x, a.min_x - b.max_x, 0.0)
            dy = max(b.min_y - a.max_y, a.min_y - b.max_y, 0.0)
            if dx <= 0.0 and dy <= 0.0:
                violations.append(
                    PlateInstanceViolation(ids[i], "collision", f"пересекается с {ids[j]}")
                )
                violations.append(
                    PlateInstanceViolation(ids[j], "collision", f"пересекается с {ids[i]}")
                )
            elif clearance_mm > 0.0 and math.hypot(dx, dy) < clearance_mm:
                violations.append(
                    PlateInstanceViolation(
                        ids[i], "clearance_failed", f"зазор до {ids[j]} < {clearance_mm}мм"
                    )
                )
                violations.append(
                    PlateInstanceViolation(
                        ids[j], "clearance_failed", f"зазор до {ids[i]} < {clearance_mm}мм"
                    )
                )

    if violations:
        raise PlateLayoutError(violations)
    return footprints
