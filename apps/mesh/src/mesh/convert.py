"""Конвертация исходных мешей в канонический 3MF.

Профиль 3MF v0 (см. `docs/epics/3mf.storage.md` § «Наш целевой профиль»):
Core + Materials and Properties + Production. Упаковку делает официальная
референс-реализация `lib3mf`; входной STL/OBJ читает `trimesh` (устойчивый
ридер, он же даёт геометрию для bbox).

Сборко- и цвето-сохраняющий разбор (MF-376): источник читается через
`trimesh.load()` без `force="mesh"` — многообъектные источники (OBJ с
несколькими `o`-группами/материалами, glTF/GLB) приходят как `trimesh.Scene`
и каждый объект сцены становится отдельным mesh-объектом 3MF со своим
build item (Production) и своим базовым материалом (Materials), вместо
схлопывания всей сцены в один меш. Однообъектные форматы (STL — плоский
список треугольников без понятия сборки) оборачиваются в Scene с одной
геометрией, чтобы пройти тот же путь.

Whitelist форматов, magic-байты и матрица «что переносится/теряется» —
`docs/epics/formats.policy.md` (MF-21/MF-375). Возможности `trimesh` по
каждому формату подтверждены спайком `apps/mesh/tests/test_format_spike.py` —
при апгрейде `trimesh` гонять спайк заново перед правкой этого модуля.
"""

from __future__ import annotations

import io
import resource
import sys
import time
import uuid
import zipfile
from dataclasses import dataclass, field
from importlib.metadata import PackageNotFoundError, version
from pathlib import Path

import lib3mf
import manifold3d
import numpy as np
import trimesh
from PIL import Image

from . import preview
from .diagnostics import MeshDiagnostics, diagnose
from .errors import RejectCode, RejectionError
from .limits import Limits, load_limits
from .sandbox import run_isolated
from .stl_reader import load_stl_mesh
from .zip_safety import check_zip_safety

# Расширения, которые кладёт этот конвертер. Проверяются структурно в
# validate_3mf() — namespace обязан присутствовать в 3D/3dmodel.model.
CORE_NS = "http://schemas.microsoft.com/3dmanufacturing/core/2015/02"
MATERIAL_NS = "http://schemas.microsoft.com/3dmanufacturing/material/2015/02"
PRODUCTION_NS = "http://schemas.microsoft.com/3dmanufacturing/production/2015/06"

# Нейтральный «болваночный» цвет по умолчанию — источники без собственного
# цвета (голый STL, OBJ без .mtl) получают одну базовую материальную группу,
# чтобы слайсер не показывал бесцветную заготовку.
_DEFAULT_MATERIAL_NAME = "Default"
_DEFAULT_COLOR = (200, 200, 200, 255)

_IDENTITY_TRANSFORM = np.eye(4)

# STL/OBJ безразмерны по спецификации, 3MF требует единицы явно — канон
# всегда пишется в миллиметрах (см. `_write_3mf`). Эвристика ниже ловит
# частый случай «источник на самом деле в дюймах» (легаси CAD-экспорт):
# если весь габарит модели меньше нескольких мм, печатать такую деталь
# физически бессмысленно — почти наверняка числа на самом деле в дюймах,
# и без поправки печать выйдет в 25.4 раза меньше нужного. Это осознанно
# грубая эвристика (не парсит намерение автора), а не точная детекция.
_INCH_TO_MM = 25.4
_SUSPICIOUSLY_SMALL_MM = 5.0

# Явный флаг единиц источника (MF-379): "mm" — умолчание, дальше работает
# эвристика выше (источник безразмерен, флаг не задан явно); любое другое
# значение — детерминированный множитель без эвристики, вызывающий код знает
# единицы источника лучше догадки по габариту.
_UNIT_TO_MM = {"mm": 1.0, "cm": 10.0, "m": 1000.0, "in": _INCH_TO_MM}

# Наш неймспейс для метаданных, которых нет в стандартном Core (id модели
# маркетплейса, источник загрузки) — Core-имена вроде Title/Designer/
# LicenseTerms пишутся без неймспейса (см. `_write_metadata`).
_CUSTOM_METADATA_NS = "https://3mf.tech/metadata/2026"


def _toolchain_versions() -> dict[str, str]:
    """Версии writer/reader/repair-библиотек, которыми был собран этот 3MF
    (MF-380 «сервисный контракт») — нужны для воспроизводимости: поведение
    записи/починки чувствительно к версии `lib3mf`/`trimesh`/`manifold3d`
    (см. docstring риска «Тулчейн/платформа» в MF-22).
    """
    versions = {"trimesh": trimesh.__version__}
    try:
        versions["lib3mf"] = ".".join(str(part) for part in lib3mf.Wrapper().GetLibraryVersion())
    except Exception:  # noqa: BLE001 — версия best-effort, не должна валить конвертацию
        pass
    try:
        versions["manifold3d"] = version("manifold3d")
    except PackageNotFoundError:
        pass
    return versions


def _memory_peak_bytes() -> int:
    """Возвращает наблюдаемый пик RSS текущего процесса и его детей.

    Разбор выполняется в дочернем процессе (`sandbox.run_isolated`), поэтому
    учитываем `RUSAGE_CHILDREN`; `ru_maxrss` — кумулятивный максимум процесса,
    но это всё равно полезная верхняя граница для отчёта и не требует новой
    runtime-зависимости вроде psutil.
    """
    try:
        multiplier = 1 if sys.platform == "darwin" else 1024
        own = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
        children = resource.getrusage(resource.RUSAGE_CHILDREN).ru_maxrss
        return int(max(own, children) * multiplier)
    except (AttributeError, OSError):
        return 0


class ConversionError(RejectionError):
    """Не удалось сконвертировать источник в валидный 3MF.

    Alias над `mesh.errors.RejectionError` — единый структурированный отказ
    (код + сообщение) для всего конвейера приёма (`stl_reader`/`zip_safety`/
    `sandbox` кидают тот же тип). Старые call-site'ы без явного кода
    получают `RejectCode.PARSE_ERROR` по умолчанию.
    """

    def __init__(self, message: str, code: RejectCode = RejectCode.PARSE_ERROR) -> None:
        super().__init__(code, message)


@dataclass(frozen=True)
class ModelMetadata:
    """Опциональная метадата источника, пишется в Core-метадату 3MF (MF-379).

    `title`/`author`/`license` — стандартные Core-имена (Title/Designer/
    LicenseTerms, без неймспейса — их знает любой ридер 3MF). `model_id`/
    `source` специфичны маркетплейсу — пишутся в наш неймспейс
    (`_CUSTOM_METADATA_NS`), т.к. Core их не определяет. Ничего не задано —
    ничего не пишется (поля опциональны с обеих сторон).
    """

    title: str | None = None
    author: str | None = None
    license: str | None = None
    model_id: str | None = None
    source: str | None = None


@dataclass(frozen=True)
class PartReport:
    """Диагностика одной детали до/после конвертации (MF-379).

    `after` — `None` в `mode="strict"` (диагностика без починки, см.
    `convert_to_3mf`); в `mode="repair"` — состояние после `_repair_mesh`
    (+ manifold3d fallback, если понадобился и вписался в бюджет).
    """

    name: str
    mode: str
    before: MeshDiagnostics
    after: MeshDiagnostics | None


@dataclass(frozen=True)
class ConversionResult:
    """Итог конвертации: путь к 3MF, габариты и диагностика геометрии.

    `bbox` — формат нейтрален к ремеслу (см. `models.bbox jsonb`):
    {min:[x,y,z], max:[x,y,z], size:[dx,dy,dz], unit:'mm'}.
    `reports` — по одному `PartReport` на каждую деталь сборки (Production
    build item), см. `mesh.diagnostics`.
    `duration_ms` — время конвертации (сервисный контракт MF-380, метрика
    времени). `toolchain_versions` — версии writer-библиотек, те же значения
    уже запечены в выходной 3MF как метадата (`_write_toolchain_metadata`),
    здесь — для structured-отчёта вызывающему коду без повторного чтения
    файла обратно.
    """

    path: Path
    bbox: dict
    reports: tuple[PartReport, ...] = ()
    duration_ms: float = 0.0
    memory_peak_bytes: int = 0
    toolchain_versions: dict[str, str] = field(default_factory=dict)


@dataclass
class _Part:
    """Один объект сцены, готовый к упаковке в 3MF: локальная геометрия
    (уже почищенная и промасштабированная), мировой transform build item'а
    и представительный RGBA-цвет."""

    name: str
    mesh: trimesh.Trimesh
    transform: np.ndarray
    color: tuple[int, int, int, int]


def _bbox_from_extent(bounds: tuple[np.ndarray, np.ndarray]) -> dict:
    lo, hi = (np.asarray(b, dtype=float) for b in bounds)
    return {
        "min": [round(float(x), 6) for x in lo],
        "max": [round(float(x), 6) for x in hi],
        "size": [round(float(x), 6) for x in (hi - lo)],
        "unit": "mm",
    }


def _load_generic_scene(source: Path) -> trimesh.Scene | trimesh.Trimesh:
    """Читает источник без `force="mesh"` — сохраняет `trimesh.Scene` для
    мультиобъектных форматов (сборко- и цвето-сохраняющий разбор, MF-376)."""
    return trimesh.load(source)


def _check_file_size(source: Path, limits: Limits) -> None:
    if not source.exists() or source.stat().st_size == 0:
        raise ConversionError(f"{source.name}: файл пуст или не найден", code=RejectCode.EMPTY_FILE)
    if source.stat().st_size > limits.max_file_bytes:
        raise ConversionError(
            f"{source.name}: размер превышает лимит {limits.max_file_bytes} байт",
            code=RejectCode.TOO_LARGE,
        )


def _load_scene(source: Path, limits: Limits | None = None) -> trimesh.Scene:
    """Читает источник в `trimesh.Scene`, не теряя мультиобъектность — в
    изолированном процессе с лимитами (MF-378).

    Однообъектные форматы (STL) дают `trimesh.Trimesh` напрямую — оборачиваем
    в Scene с единственной геометрией, чтобы дальше был один код пути для
    single-part и multi-part источников. STL проходит структурную проверку
    (`stl_reader`) до передачи в trimesh; остальные форматы получают только
    общий cap на размер/треугольники/время/память — разбор всегда идёт в
    отдельном процессе (`sandbox.run_isolated`), т.к. вход враждебен (см.
    CLAUDE.md зоны mesh).
    """
    limits = limits if limits is not None else load_limits()
    _check_file_size(source, limits)

    try:
        if source.suffix.lower() == ".stl":
            loaded = run_isolated(load_stl_mesh, (source, limits), limits)
        else:
            loaded = run_isolated(_load_generic_scene, (source,), limits)
    except RejectionError as exc:
        raise ConversionError(str(exc), code=exc.code) from exc
    except Exception as exc:  # noqa: BLE001 — источник от пользователя, любой сбой = ошибка конвертации
        raise ConversionError(f"не удалось прочитать источник {source.name}: {exc}") from exc

    if isinstance(loaded, trimesh.Scene):
        scene = loaded
    elif isinstance(loaded, trimesh.Trimesh):
        scene = trimesh.Scene()
        scene.add_geometry(loaded, geom_name=source.stem or "part")
    else:
        raise ConversionError(f"источник {source.name} не дал распознаваемой геометрии")

    total_faces = 0
    for geom in scene.geometry.values():
        if isinstance(geom, trimesh.Trimesh):
            total_faces += geom.faces.shape[0]

    if total_faces == 0:
        raise ConversionError(
            f"источник {source.name} не содержит треугольной геометрии",
            code=RejectCode.NOT_MESH,
        )
    if total_faces > limits.max_triangles:
        raise ConversionError(
            f"{source.name}: {total_faces} треугольников после разбора, "
            f"лимит {limits.max_triangles}",
            code=RejectCode.TOO_MANY_TRIANGLES,
        )

    return scene


def _repair_mesh(mesh: trimesh.Trimesh) -> None:
    """Чинит геометрию на месте перед экспортом: дубли вершин, вырожденные/
    дублирующиеся грани, ориентация нормалей, попытка залатать простые дыры.

    Best-effort: `fill_holes` не гарантирует полный watertight на сложных
    источниках (это не всегда физически корректно на openable-геометрии) —
    остаточная непочинка не считается ошибкой конвертации, только упущенное
    улучшение.
    """
    mesh.merge_vertices()
    mesh.update_faces(mesh.nondegenerate_faces())
    mesh.update_faces(mesh.unique_faces())
    mesh.remove_unreferenced_vertices()
    trimesh.repair.fix_winding(mesh)
    trimesh.repair.fix_normals(mesh)
    if not mesh.is_watertight:
        trimesh.repair.fill_holes(mesh)


def _manifold_fallback_repair(mesh: trimesh.Trimesh) -> bool:
    """Последняя попытка на «почти-manifold» геометрии, которую `fill_holes`
    не берёт: прогоняем меш через `manifold3d` (тот же движок, что булевы
    операции — он мержит геометрию к валидному 2-manifold или отказывается)
    и заменяем меш результатом, если получилось. Best-effort и без
    гарантий: `manifold3d.Manifold` сам умеет отказаться (`status() !=
    NoError`) на геометрии, которую не может привести к манифолду — тогда
    просто выходим, оставляя уже применённую trimesh-починку как есть (см.
    `_repair_mesh` docstring — остаточная непочинка не ошибка).

    Возвращает True, если меш заменён починенной геометрией.
    """
    if mesh.is_watertight or len(mesh.faces) == 0:
        return False
    try:
        source = manifold3d.Mesh(
            vert_properties=np.asarray(mesh.vertices, dtype=np.float32),
            tri_verts=np.asarray(mesh.faces, dtype=np.uint32),
        )
        manifold = manifold3d.Manifold(source)
        if manifold.status() != manifold3d.Error.NoError or manifold.is_empty():
            return False
        fixed = manifold.to_mesh()
    except Exception:  # noqa: BLE001 — best-effort, сбой manifold3d не должен валить конвертацию
        return False

    vertices = np.asarray(fixed.vert_properties, dtype=np.float64)
    faces = np.asarray(fixed.tri_verts, dtype=np.int64)
    if len(faces) == 0:
        return False
    mesh.vertices = vertices
    mesh.faces = faces
    return True


def _infer_unit_scale(scene: trimesh.Scene) -> float:
    """Возвращает поправочный масштаб для приведения источника к миллиметрам.

    См. комментарий у `_SUSPICIOUSLY_SMALL_MM` — единственный сигнал,
    которым мы располагаем без явного указания единиц пользователем.
    """
    extents = np.asarray(scene.extents, dtype=float) if scene.extents is not None else None
    if extents is None or extents.max() <= 0:
        return 1.0
    if float(extents.max()) < _SUSPICIOUSLY_SMALL_MM:
        return _INCH_TO_MM
    return 1.0


def _unit_scale(scene: trimesh.Scene, unit: str) -> float:
    """Множитель до миллиметров для явного флага единиц (MF-379).

    `unit="mm"` (умолчание) — источник безразмерен и флаг не уточнён явно,
    работает эвристика `_infer_unit_scale` (подозрительно маленький габарит
    → похоже на дюймы). Любое другое значение из `_UNIT_TO_MM` —
    детерминированный множитель без эвристики: вызывающий код (апстрим,
    флаг пользователя) знает единицы источника лучше догадки по габариту.
    """
    if unit not in _UNIT_TO_MM:
        raise ConversionError(
            f"неизвестная единица '{unit}', допустимо: {sorted(_UNIT_TO_MM)}",
            code=RejectCode.UNKNOWN_UNIT,
        )
    if unit != "mm":
        return _UNIT_TO_MM[unit]
    return _infer_unit_scale(scene)


def _geometry_color(mesh: trimesh.Trimesh) -> tuple[int, int, int, int]:
    """Представительный RGBA источника: материал (OBJ/.mtl, glTF PBR) →
    face/vertex-цвет → нейтральный дефолт, если источник цвет не несёт (STL).
    """
    visual = mesh.visual
    kind = getattr(visual, "kind", None)
    try:
        if kind == "texture" and hasattr(visual, "material"):
            material = visual.material
            color = getattr(material, "main_color", None)
            if color is None:
                color = getattr(material, "diffuse", None)
            if color is not None and len(color) >= 3:
                rgb = [int(c) for c in color[:3]]
                alpha = int(color[3]) if len(color) >= 4 else 255
                return (*rgb, alpha)
        elif kind == "vertex" and len(visual.vertex_colors):
            return tuple(int(c) for c in visual.vertex_colors[0])
        elif kind == "face" and len(visual.face_colors):
            return tuple(int(c) for c in visual.face_colors[0])
    except Exception:  # noqa: BLE001 — цвет опционален, дефолт всегда доступен
        pass
    return _DEFAULT_COLOR


def _scene_to_parts(
    scene: trimesh.Scene,
    unit: str = "mm",
    mode: str = "repair",
    limits: Limits | None = None,
) -> tuple[list[_Part], list[PartReport]]:
    """Разбирает сцену на промасштабированные части с их мировыми
    transform'ами, цветом и диагностикой — готовые для упаковки в 3MF.

    `mode="repair"` (умолчание, прежнее поведение) чинит геометрию
    (`_repair_mesh` + `_manifold_fallback_repair`) и логирует, что
    изменилось; `mode="strict"` только диагностирует, геометрию не трогает
    (MF-379). Чиним/диагностируем/масштабируем один раз на уникальную
    геометрию — сцена может переиспользовать её в нескольких build item'ах
    (инстансинг), повторная обработка на part'ах испортила бы данные.
    """
    if mode not in ("strict", "repair"):
        raise ValueError(f"неизвестный режим '{mode}', допустимо: strict, repair")
    limits = limits if limits is not None else load_limits()

    scale = _unit_scale(scene, unit)
    reports_by_geom: dict[str, PartReport] = {}
    for geom_name, geom in scene.geometry.items():
        if not isinstance(geom, trimesh.Trimesh):
            continue

        if mode == "repair" and geom.faces.shape[0] > limits.max_repair_triangles:
            raise ConversionError(
                f"деталь '{geom_name}': {geom.faces.shape[0]} треугольников, "
                f"потолок починки {limits.max_repair_triangles} — отклонено по бюджету "
                "(см. mode='strict' для диагностики без починки)",
                code=RejectCode.TOO_EXPENSIVE_TO_REPAIR,
            )

        before = diagnose(geom, budget_triangles=limits.max_repair_triangles)
        after: MeshDiagnostics | None = None
        if mode == "repair":
            _repair_mesh(geom)
            if not geom.is_watertight:
                _manifold_fallback_repair(geom)
            after = diagnose(geom, budget_triangles=limits.max_repair_triangles)

        if scale != 1.0:
            geom.apply_scale(scale)

        reports_by_geom[str(geom_name)] = PartReport(
            name=str(geom_name), mode=mode, before=before, after=after
        )

    parts: list[_Part] = []
    reports: list[PartReport] = []
    for index, node in enumerate(scene.graph.nodes_geometry):
        transform, geom_name = scene.graph.get(node)
        geom = scene.geometry.get(geom_name)
        if not isinstance(geom, trimesh.Trimesh) or geom.faces.shape[0] == 0:
            continue
        world_transform = np.array(transform, dtype=float)
        world_transform[:3, 3] *= scale
        parts.append(
            _Part(
                name=str(geom_name) or f"part_{index}",
                mesh=geom,
                transform=world_transform,
                color=_geometry_color(geom),
            )
        )
        report = reports_by_geom.get(str(geom_name))
        if report is not None:
            reports.append(report)

    if not parts:
        raise ConversionError("источник не содержит треугольной геометрии после очистки")
    return parts, reports


def _stable_orientation_transform(parts: list[_Part]) -> np.ndarray:
    """Поворот сборки «дном к полу» (MF-827): считается один раз на сборку
    в мировых координатах.

    `trimesh.Trimesh.compute_stable_poses` (полноценная физическая
    симуляция через выпуклую оболочку) сюда не идёт — оболочка у trimesh
    считается через `scipy.spatial.ConvexHull`, а `scipy` в `apps/mesh`
    намеренно не тянется (см. `mesh.diagnostics` docstring и комментарий у
    `_fixture_multipart_colored_obj` в `tests/test_convert.py` — тот же
    принцип). Вместо этого — упрощённая эвристика без выпуклой оболочки:
    грани мировой сборки группируются по направлению нормали (площадь
    накапливается по группе — одна плоская опорная сторона источника
    обычно состоит из многих мелких треугольников с одинаковой нормалью,
    не обязательно смежных после починки/децимации), и самая большая по
    суммарной площади группа становится «низом» — её нормаль выравнивается
    на -Z (`trimesh.geometry.align_vectors`, чистая линейная алгебра —
    `numpy.linalg.svd`, тоже без scipy), затем сборка сдвигается по Z так,
    чтобы касаться пола (min Z = 0).

    Это не полный физический расчёт устойчивости (нет проверки, что центр
    масс проецируется внутрь опорного полигона) — приближение, верное для
    типичного случая (плоское основание, повёрнутый CAD-экспорт), которое
    и требуют критерии приёмки MF-827. На органике/шарах может ошибиться —
    осознанно допустимо (см. UX-спека MF-827: дверь фидбека на карточке,
    ручной контрол — по сигналу, не заранее).

    Возвращает единую 4x4-трансформацию для применения ко всем `part.transform`
    (`_apply_orientation`) — так поворот запекается один раз и в 3MF (build
    item'ы `_write_3mf`), и в превью/thumbnail, которые рендерятся из тех же
    part'ов дальше по конвейеру (см. `convert_to_3mf`, `_thumbnail_png_bytes`).

    Best-effort: на вырожденной геометрии (нулевая площадь) возвращаем
    identity — модель остаётся в исходной ориентации источника, не хуже
    поведения без этой функции.
    """
    try:
        assembly = _assembly_mesh(parts)
        if assembly.faces.shape[0] == 0:
            return _IDENTITY_TRANSFORM

        areas = assembly.area_faces
        normals = assembly.face_normals
        if areas.sum() <= 0:
            return _IDENTITY_TRANSFORM

        rounded_normals = np.round(normals, 2)
        area_by_direction: dict[tuple[float, ...], float] = {}
        normal_by_direction: dict[tuple[float, ...], np.ndarray] = {}
        for normal, area, rounded in zip(normals, areas, rounded_normals, strict=True):
            key = tuple(rounded)
            area_by_direction[key] = area_by_direction.get(key, 0.0) + float(area)
            normal_by_direction.setdefault(key, normal)

        down_key = max(area_by_direction, key=area_by_direction.get)
        down = normal_by_direction[down_key]
        down_norm = np.linalg.norm(down)
        if down_norm == 0.0:
            return _IDENTITY_TRANSFORM
        down = down / down_norm

        orientation = trimesh.geometry.align_vectors(down, np.array([0.0, 0.0, -1.0]))
        rotated = assembly.copy()
        rotated.apply_transform(orientation)
        orientation[2, 3] -= rotated.bounds[0][2]
    except Exception:  # noqa: BLE001 — ориентация best-effort, сбой не должен валить конвертацию
        return _IDENTITY_TRANSFORM
    return np.asarray(orientation, dtype=float)


def _apply_orientation(parts: list[_Part], orientation: np.ndarray) -> None:
    if np.allclose(orientation, _IDENTITY_TRANSFORM):
        return
    for part in parts:
        part.transform = orientation @ part.transform


def _scene_bbox(parts: list[_Part]) -> dict:
    lows = []
    highs = []
    for part in parts:
        rotation = part.transform[:3, :3]
        translation = part.transform[:3, 3]
        world_vertices = part.mesh.vertices @ rotation.T + translation
        lows.append(world_vertices.min(axis=0))
        highs.append(world_vertices.max(axis=0))
    lo = np.min(np.vstack(lows), axis=0)
    hi = np.max(np.vstack(highs), axis=0)
    return _bbox_from_extent((lo, hi))


def _to_lib3mf_transform(matrix: np.ndarray) -> tuple:
    return (
        tuple(float(x) for x in matrix[0, :3]),
        tuple(float(x) for x in matrix[1, :3]),
        tuple(float(x) for x in matrix[2, :3]),
        tuple(float(x) for x in matrix[:3, 3]),
    )


def _write_metadata(model: lib3mf.Model, metadata: ModelMetadata | None) -> None:
    """Пишет Core-метадату (Title/Designer/LicenseTerms) плюс наши
    маркетплейс-специфичные поля (id модели/источник) в `_CUSTOM_METADATA_NS`
    — Core их не определяет (MF-379). Каждое поле опционально, ничего не
    задано — ничего не пишется.
    """
    if metadata is None:
        return
    group = model.GetMetaDataGroup()
    if metadata.title:
        group.AddMetaData("", "Title", metadata.title, "xs:string", False)
    if metadata.author:
        group.AddMetaData("", "Designer", metadata.author, "xs:string", False)
    if metadata.license:
        group.AddMetaData("", "LicenseTerms", metadata.license, "xs:string", False)
    if metadata.model_id:
        group.AddMetaData(_CUSTOM_METADATA_NS, "ModelId", metadata.model_id, "xs:string", False)
    if metadata.source:
        group.AddMetaData(_CUSTOM_METADATA_NS, "Source", metadata.source, "xs:string", False)


def _write_toolchain_metadata(model: lib3mf.Model, versions: dict[str, str]) -> None:
    """Пишет версии writer-тулчейна (`_toolchain_versions`) в кастомный
    неймспейс — всегда, независимо от того, задана ли `ModelMetadata`
    (воспроизводимость нужна на каждом выходе, не только с явной метадатой).
    """
    group = model.GetMetaDataGroup()
    for name, value in versions.items():
        group.AddMetaData(_CUSTOM_METADATA_NS, f"Toolchain.{name}", value, "xs:string", False)


def _assembly_mesh(parts: list[_Part]) -> trimesh.Trimesh:
    """Собирает part'ы в один меш в мировых координатах — только для рендера
    thumbnail, в упаковку 3MF не идёт (там части остаются раздельными
    объектами, см. `_write_3mf`)."""
    pieces = []
    for part in parts:
        piece = part.mesh.copy()
        piece.apply_transform(part.transform)
        pieces.append(piece)
    if len(pieces) == 1:
        return pieces[0]
    return trimesh.util.concatenate(pieces)


def _thumbnail_png_bytes(parts: list[_Part]) -> bytes | None:
    """PNG сборки для встраивания в `/Metadata/thumbnail.png` (MF-379).

    Переиспользует софт-растеризатор `preview.py` (MF-471, та же картинка,
    что видит каталог) — только PNG вместо webp и непрозрачный фон: этот
    thumbnail открывают слайсеры/проводник, не CSS-подложка каталога.
    Best-effort: рендер не должен валить конвертацию — любой сбой здесь
    просто оставляет 3MF без встроенного превью.
    """
    try:
        mesh = _assembly_mesh(parts)
        render_mesh = preview._decimate(mesh, preview.THUMBNAIL_MAX_FACES)
        render_size = preview.THUMBNAIL_SIZE * preview.THUMBNAIL_SSAA
        hi = preview._render_thumbnail_rgba(render_mesh, render_size)
        rgba = preview._downsample_rgba(hi, preview.THUMBNAIL_SSAA)
    except Exception:  # noqa: BLE001 — превью опционально, отсутствие не ошибка конвертации
        return None
    if not (rgba[..., 3] > 0).any():
        return None

    # Непрозрачный белый фон — thumbnail 3MF открывают в проводнике/слайсере
    # (нет CSS-подложки каталога, которая рисует фон за webp-миниатюру).
    alpha = rgba[..., 3:4].astype(np.float64) / 255.0
    rgb = rgba[..., :3].astype(np.float64) * alpha + 255.0 * (1.0 - alpha)
    opaque = np.dstack([rgb, np.full_like(alpha, 255.0)]).astype(np.uint8)

    buffer = io.BytesIO()
    Image.fromarray(opaque, mode="RGBA").save(buffer, format="PNG")
    return buffer.getvalue()


def _write_thumbnail(model: lib3mf.Model, png_bytes: bytes | None) -> None:
    if not png_bytes:
        return
    attachment = model.CreatePackageThumbnailAttachment()
    attachment.ReadFromBuffer(png_bytes)


def _write_3mf(
    parts: list[_Part],
    destination: Path,
    metadata: ModelMetadata | None = None,
    thumbnail: bool = True,
) -> None:
    """Пакует части в 3MF профиля Core + Materials + Production через lib3mf.

    Каждая часть — отдельный mesh-объект + build item со своим transform
    (сборка сохраняется, Production — lib3mf сам присваивает p:UUID каждому
    объекту и build item'у, отдельно выставлять не нужно), с базовым
    материалом её цвета (Materials); одинаковые цвета переиспользуют одну
    материальную группу. Опционально — Core-метадата (`_write_metadata`) и
    встроенный PNG-thumbnail (`_write_thumbnail`, MF-379).
    """
    wrapper = lib3mf.Wrapper()
    model = wrapper.CreateModel()
    model.SetUnit(lib3mf.ModelUnit.MilliMeter)

    material_group = model.AddBaseMaterialGroup()
    material_ids: dict[tuple[int, int, int, int], int] = {}

    def _material_id_for(color: tuple[int, int, int, int]) -> int:
        if color not in material_ids:
            if color == _DEFAULT_COLOR:
                name = _DEFAULT_MATERIAL_NAME
            else:
                name = f"material_{len(material_ids) + 1}"
            material_ids[color] = material_group.AddMaterial(name, lib3mf.Color(*color))
        return material_ids[color]

    for part in parts:
        mesh_object = model.AddMeshObject()
        mesh_object.SetName(part.name)

        vertices = [lib3mf.Position(tuple(float(c) for c in v)) for v in part.mesh.vertices]
        triangles = [lib3mf.Triangle(tuple(int(i) for i in f)) for f in part.mesh.faces]
        mesh_object.SetGeometry(vertices, triangles)

        material_id = _material_id_for(part.color)
        mesh_object.SetObjectLevelProperty(material_group.GetResourceID(), material_id)

        model.AddBuildItem(mesh_object, lib3mf.Transform(_to_lib3mf_transform(part.transform)))

    model.SetBuildUUID(str(uuid.uuid4()))
    _write_metadata(model, metadata)
    _write_toolchain_metadata(model, _toolchain_versions())
    if thumbnail:
        _write_thumbnail(model, _thumbnail_png_bytes(parts))

    writer = model.QueryWriter("3mf")
    writer.WriteToFile(str(destination))


def validate_3mf(path: Path, limits: Limits | None = None) -> None:
    """Структурная валидность 3MF: OPC-пакет + обязательные части + namespaces.

    Не полная спека-валидация (её делает lib3mf при чтении), но достаточно,
    чтобы поймать битый пакет до заливки в S3 и подтвердить целевой профиль.
    Перед чтением содержимого архив проходит `zip_safety` (zip-бомба/path
    traversal) — этот же путь используют собственные выходы `_write_3mf`,
    так что защита работает и на них, не только на пользовательский вход.
    """
    limits = limits if limits is not None else load_limits()
    if not zipfile.is_zipfile(path):
        raise ConversionError(
            f"{path.name} не является OPC-пакетом (zip)", code=RejectCode.INVALID_ZIP
        )
    try:
        check_zip_safety(path, limits)
    except RejectionError as exc:
        raise ConversionError(str(exc), code=exc.code) from exc

    with zipfile.ZipFile(path) as archive:
        names = set(archive.namelist())
        for required in ("[Content_Types].xml", "_rels/.rels", "3D/3dmodel.model"):
            if required not in names:
                raise ConversionError(
                    f"в 3MF отсутствует обязательная часть {required}",
                    code=RejectCode.INVALID_ZIP,
                )
        model_xml = archive.read("3D/3dmodel.model").decode("utf-8", errors="replace")

    for ns, label in ((CORE_NS, "Core"), (MATERIAL_NS, "Materials"), (PRODUCTION_NS, "Production")):
        if ns not in model_xml:
            raise ConversionError(
                f"в 3MF нет namespace расширения {label}", code=RejectCode.INVALID_ZIP
            )


def convert_to_3mf(
    source: Path,
    destination: Path,
    limits: Limits | None = None,
    unit: str = "mm",
    mode: str = "repair",
    metadata: ModelMetadata | None = None,
    thumbnail: bool = True,
) -> ConversionResult:
    """Конвертирует мешевый источник (STL/OBJ/…) в валидный канонический 3MF.

    Мультиобъектные источники сохраняют разбиение на детали (Production
    build items) и цвет/материал каждой детали (Materials) — сцена не
    схлопывается в один меш.

    `unit` — явные единицы источника ("mm"/"cm"/"m"/"in"); при умолчании
    "mm" работает эвристика для безразмерных/подозрительно маленьких
    источников (похоже на дюймы), явный флаг — детерминированный множитель
    без эвристики (MF-379).

    `mode="repair"` (умолчание) чинит геометрию (дубли вершин, вырожденные
    грани, ориентация нормалей, дыры, best-effort manifold3d-фолбэк) —
    репорт по каждой детали в `ConversionResult.reports` показывает, что
    изменилось. `mode="strict"` только диагностирует, геометрию не трогает.
    Слишком дорогая для починки деталь (`Limits.max_repair_triangles`)
    отклоняется по бюджету в `mode="repair"` — используйте `mode="strict"`
    для одной диагностики без риска зависнуть на патологической геометрии.

    `metadata`/`thumbnail` — опциональные Core-метадата и встроенный PNG
    (`/Metadata/thumbnail.png`), см. `_write_metadata`/`_write_thumbnail`.

    Автоориентация «дном к полу» (MF-827): сборка поворачивается в самую
    вероятную устойчивую позу (`_stable_orientation_transform`) один раз,
    до записи 3MF и bbox — так превью (GLB/webp, генерятся из canonical_3mf
    дальше по конвейеру, `worker.store_previews_from_canonical`) и
    скачиваемый 3MF совпадают с тем, что видно на карточке. Best-effort:
    вырожденная геометрия без устойчивых поз оставляет исходную ориентацию.

    Возвращает путь, bbox сборки и диагностику. Кидает ConversionError при
    любом сбое разбора/упаковки.
    """
    limits = limits if limits is not None else load_limits()
    started = time.monotonic()
    scene = _load_scene(source, limits)
    parts, reports = _scene_to_parts(scene, unit=unit, mode=mode, limits=limits)
    _apply_orientation(parts, _stable_orientation_transform(parts))
    bbox = _scene_bbox(parts)
    _write_3mf(parts, destination, metadata=metadata, thumbnail=thumbnail)
    validate_3mf(destination, limits)
    return ConversionResult(
        path=destination,
        bbox=bbox,
        reports=tuple(reports),
        duration_ms=(time.monotonic() - started) * 1000.0,
        memory_peak_bytes=_memory_peak_bytes(),
        toolchain_versions=_toolchain_versions(),
    )


def passthrough_3mf(
    source: Path, destination: Path, limits: Limits | None = None
) -> ConversionResult:
    """Вход уже 3MF — базовая валидация + перекладка как канонический.

    v0 не переупаковывает и не доводит профиль входного 3MF — только проверяет,
    что это валидный OPC-пакет с моделью, и вычисляет bbox через сцену Scene
    (мультиобъектность/цвет уже есть во входном файле как есть, мы их не
    трогаем — только читаем для габарита). Namespace-профиль входного 3MF
    может отличаться от нашего; для passthrough требуем только Core-часть
    (полноценная нормализация — следующая итерация). Архив проходит
    `zip_safety` (zip-бомба/path traversal) до чтения содержимого, и всё
    чтение геометрии — в изолированном процессе (`_load_scene`).
    """
    limits = limits if limits is not None else load_limits()
    started = time.monotonic()
    _check_file_size(source, limits)

    if not zipfile.is_zipfile(source):
        raise ConversionError(
            f"{source.name} не является валидным 3MF (OPC-пакет)", code=RejectCode.INVALID_ZIP
        )
    try:
        check_zip_safety(source, limits)
    except RejectionError as exc:
        raise ConversionError(str(exc), code=exc.code) from exc

    with zipfile.ZipFile(source) as archive:
        names = set(archive.namelist())
        for required in ("[Content_Types].xml", "3D/3dmodel.model"):
            if required not in names:
                raise ConversionError(
                    f"во входном 3MF нет обязательной части {required}", code=RejectCode.INVALID_ZIP
                )

    scene = _load_scene(source, limits)
    bbox = _bbox_from_extent((scene.bounds[0], scene.bounds[1]))

    destination.write_bytes(source.read_bytes())
    return ConversionResult(
        path=destination,
        bbox=bbox,
        duration_ms=(time.monotonic() - started) * 1000.0,
        memory_peak_bytes=_memory_peak_bytes(),
        toolchain_versions=_toolchain_versions(),
    )


# Обратная совместимость со старой заглушкой (tests/вызовы по имени stl_to_3mf).
def stl_to_3mf(source: Path, destination: Path) -> Path:
    """Тонкая обёртка над convert_to_3mf для совместимости со старым API."""
    return convert_to_3mf(source, destination).path
