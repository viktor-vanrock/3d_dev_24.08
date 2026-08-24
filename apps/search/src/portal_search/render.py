"""Multi-view рендер STL/3MF для эмбеддинга «по форме» (MF-1998).

HYPERPC слот 4 не завёл отдельную 3D-модель эмбеддинга (Uni3D) — политика
из `docs/process/hyperpc.local.llm.md` § «Слот 4»: рендерить несколько
ракурсов на своей стороне (`trimesh`, дёшево по CPU) и слать картинки в
`/embed`. Здесь — эта сторона: чистый numpy z-buffer растеризатор, без
OpenGL/GPU (headless VDS, тот же принцип, что `apps/mesh/src/mesh/preview.py`
использует для каталожных превью).

**Границы (apps/search/readme.md): не импортить код apps/mesh.** Это
независимая, более простая реализация под другую задачу — не превью для
пользователя (полигонаж/вес/double-sided там не нужны), а силуэт+форма для
эмбеддинга: несколько ракурсов вокруг модели с общим масштабом, чтобы
эмбеддинги разных ракурсов одной модели были сопоставимы.

`RenderError` — как `PreviewError` у Mesh: рендер одной модели не должен
ронять индексацию батча (worker.py ловит и пропускает превью-эмбеддинг для
этой модели, не весь тик).
"""

from __future__ import annotations

import io
from dataclasses import dataclass

import numpy as np
import trimesh
from PIL import Image

DEFAULT_VIEW_SIZE = 224  # типичный вход vision-эмбеддера, дёшево по CPU

# 4 азимута вокруг вертикальной оси на умеренном подъёме камеры — минимальный
# набор, который отличает «спереди» от «сбоку» без фотореалистичной сцены;
# добавить больше ракурсов — не архитектурное решение, а тюнинг recall@k на
# golden-set (tests/golden), см. eval_multi_view при появлении данных.
DEFAULT_VIEWS: tuple[tuple[float, float], ...] = (
    (0.0, 25.0),
    (90.0, 25.0),
    (180.0, 25.0),
    (270.0, 25.0),
)

_BG_RGB = (245, 245, 245)


class RenderError(Exception):
    """Геометрия не рендерится (пустой меш, вырожденный габарит) — не валит батч."""


@dataclass(frozen=True)
class RenderedView:
    azimuth_deg: float
    elevation_deg: float
    png_bytes: bytes


def load_mesh(data: bytes, file_hint: str) -> trimesh.Trimesh:
    """Парсит STL/3MF/OBJ/PLY-байты в один `Trimesh`. `file_hint` — расширение без точки."""
    try:
        loaded = trimesh.load(
            file_obj=io.BytesIO(data), file_type=file_hint.lower().lstrip("."), force="mesh"
        )
    except Exception as exc:  # noqa: BLE001 — любой парсер-сбой -> явная RenderError
        raise RenderError(f"не удалось распарсить {file_hint}: {exc}") from exc
    if not isinstance(loaded, trimesh.Trimesh) or loaded.faces.shape[0] == 0:
        raise RenderError(f"{file_hint}: нет треугольников после парсинга")
    return loaded


def render_views(
    mesh: trimesh.Trimesh, *, size: int = DEFAULT_VIEW_SIZE, views: tuple = DEFAULT_VIEWS
) -> list[RenderedView]:
    """Рендерит `mesh` с каждого ракурса в `views`, общий масштаб на все ракурсы.

    Общий (не per-view) масштаб важен: если бы каждый ракурс вписывался в
    кадр отдельно, силуэты стали бы несопоставимы между собой (узкая деталь
    сбоку выглядела бы такой же большой, как широкая спереди) — эмбеддер
    видел бы искажённые пропорции формы.
    """
    verts = np.asarray(mesh.vertices, dtype=np.float64)
    faces = np.asarray(mesh.faces, dtype=np.int64)
    normals = np.asarray(mesh.face_normals, dtype=np.float64)
    if faces.shape[0] == 0:
        raise RenderError("нельзя отрендерить меш без треугольников")

    center = 0.5 * (verts.min(axis=0) + verts.max(axis=0))
    centered = verts - center
    radius = float(np.max(np.linalg.norm(centered, axis=1))) if centered.size else 0.0
    if radius <= 0:
        raise RenderError("вырожденная геометрия: нулевой габарит")

    rendered = []
    for azimuth_deg, elevation_deg in views:
        rgba = _render_one(centered, faces, normals, radius, azimuth_deg, elevation_deg, size)
        buf = io.BytesIO()
        Image.fromarray(rgba, mode="RGBA").save(buf, format="PNG")
        rendered.append(
            RenderedView(
                azimuth_deg=azimuth_deg, elevation_deg=elevation_deg, png_bytes=buf.getvalue()
            )
        )
    return rendered


def _rotation_matrix(azimuth_deg: float, elevation_deg: float) -> np.ndarray:
    az = np.radians(azimuth_deg)
    el = np.radians(elevation_deg)
    rot_z = np.array(
        [[np.cos(az), -np.sin(az), 0.0], [np.sin(az), np.cos(az), 0.0], [0.0, 0.0, 1.0]]
    )
    rot_x = np.array(
        [[1.0, 0.0, 0.0], [0.0, np.cos(el), -np.sin(el)], [0.0, np.sin(el), np.cos(el)]]
    )
    return rot_x @ rot_z


def _render_one(
    centered: np.ndarray,
    faces: np.ndarray,
    normals: np.ndarray,
    radius: float,
    azimuth_deg: float,
    elevation_deg: float,
    size: int,
) -> np.ndarray:
    rot = _rotation_matrix(azimuth_deg, elevation_deg)
    view = centered @ rot.T
    view_normals = normals @ rot.T

    margin = 0.85
    scale = (size / 2.0) * margin / radius
    screen_x = view[:, 0] * scale + size / 2.0
    screen_y = -view[:, 1] * scale + size / 2.0
    depth = view[:, 2]

    light_dir = np.array([0.3, 0.4, 1.0])
    light_dir = light_dir / np.linalg.norm(light_dir)

    rgba = np.zeros((size, size, 4), dtype=np.float64)
    rgba[..., :3] = np.array(_BG_RGB, dtype=np.float64)
    zbuf = np.full((size, size), -np.inf, dtype=np.float64)

    tri_x = screen_x[faces]
    tri_y = screen_y[faces]
    tri_z = depth[faces]

    ambient = 0.35
    for i in range(faces.shape[0]):
        _rasterize_triangle(
            rgba, zbuf, tri_x[i], tri_y[i], tri_z[i], view_normals[i], light_dir, ambient, size
        )

    return np.clip(rgba, 0, 255).astype(np.uint8)


def _rasterize_triangle(
    rgba: np.ndarray,
    zbuf: np.ndarray,
    tx: np.ndarray,
    ty: np.ndarray,
    tz: np.ndarray,
    normal: np.ndarray,
    light_dir: np.ndarray,
    ambient: float,
    size: int,
) -> None:
    min_x = max(int(np.floor(tx.min())), 0)
    max_x = min(int(np.ceil(tx.max())), size - 1)
    min_y = max(int(np.floor(ty.min())), 0)
    max_y = min(int(np.ceil(ty.max())), size - 1)
    if min_x > max_x or min_y > max_y:
        return

    diffuse = max(0.0, float(np.dot(normal, light_dir)))
    shade = min(1.0, ambient + (1.0 - ambient) * diffuse)
    color = shade * 255.0

    denom = (ty[1] - ty[2]) * (tx[0] - tx[2]) + (tx[2] - tx[1]) * (ty[0] - ty[2])
    if denom == 0:
        return

    ys, xs = np.mgrid[min_y : max_y + 1, min_x : max_x + 1]
    px = xs.astype(np.float64) + 0.5
    py = ys.astype(np.float64) + 0.5

    w0 = ((ty[1] - ty[2]) * (px - tx[2]) + (tx[2] - tx[1]) * (py - ty[2])) / denom
    w1 = ((ty[2] - ty[0]) * (px - tx[2]) + (tx[0] - tx[2]) * (py - ty[2])) / denom
    w2 = 1.0 - w0 - w1

    inside = (w0 >= 0) & (w1 >= 0) & (w2 >= 0)
    if not np.any(inside):
        return

    depth = w0 * tz[0] + w1 * tz[1] + w2 * tz[2]
    region_z = zbuf[min_y : max_y + 1, min_x : max_x + 1]
    closer = inside & (depth > region_z)
    if not np.any(closer):
        return

    region_z[closer] = depth[closer]
    region_rgb = rgba[min_y : max_y + 1, min_x : max_x + 1, :3]
    region_rgb[closer] = color
    rgba[min_y : max_y + 1, min_x : max_x + 1, 3][closer] = 255.0
