"""Превью отдельной детали (объекта) внутри мультиобъектного 3MF (MF-1011).

Часть [MF-367](эпик MF-18): гайд сборки ссылается на конкретную деталь модели
(`build_steps.mesh_object_ref`, см. миграцию `20260711190000_build_guide_foundation.sql`)
— шагу нужно превью НЕ всей сборки, а одного объекта внутри неё. Переиспользуем тот
же рендер-пайплайн, что и `mesh.preview` (GLB-вьюер + webp-миниатюра): единственная
новая часть здесь — вычленить геометрию одной детали из канонического 3MF, а не всей
сцены целиком.

`part_id` = имя объекта, как оно попало в канонический 3MF (`convert._Part.name`,
источник — `trimesh.Scene.geometry` ключ исходной сцены). Тот же идентификатор
trimesh отдаёт назад при чтении канона (`trimesh.load(..., ) -> Scene.geometry`),
так что круглый путь конвертации сохраняет соответствие деталь ↔ имя без отдельной
DB-колонки — тонкая гранулярность объекта внутри 3MF сознательно вне схемы
(комментарий к `mesh_object_ref` в миграции).
"""

from __future__ import annotations

import trimesh

from .preview import PreviewError, generate_previews


class PartNotFoundError(PreviewError):
    """`part_id` не найден среди объектов канонического 3MF."""


def _load_scene(canonical_path) -> trimesh.Scene:
    loaded = trimesh.load(canonical_path)
    if isinstance(loaded, trimesh.Trimesh):
        # Однообъектный 3MF читается как голый Trimesh — оборачиваем, чтобы
        # вызывающему не нужно было различать однодетальные/мультидетальные модели.
        scene = trimesh.Scene()
        scene.add_geometry(loaded, node_name="part", geom_name="part")
        return scene
    if not isinstance(loaded, trimesh.Scene):
        raise PreviewError(f"канонический 3MF дал неожиданный тип геометрии: {type(loaded)!r}")
    return loaded


def list_part_ids(canonical_path) -> list[str]:
    """Имена всех деталей (объектов) канонического 3MF, доступных для превью."""
    scene = _load_scene(canonical_path)
    return [str(name) for name in scene.geometry]


def load_part_mesh(canonical_path, part_id: str) -> trimesh.Trimesh:
    """Вычленяет геометрию одной детали из канонического 3MF, в мировых координатах.

    Мировой transform build item'а применяется (как в `convert._scene_to_parts`), а
    не пропускается — иначе превью детали не совпадёт с её ориентацией в сборке.
    """
    scene = _load_scene(canonical_path)
    if part_id not in scene.geometry:
        available = ", ".join(sorted(str(n) for n in scene.geometry)) or "(нет деталей)"
        raise PartNotFoundError(f"деталь '{part_id}' не найдена в 3MF. Доступны: {available}")

    mesh = scene.geometry[part_id]
    if not isinstance(mesh, trimesh.Trimesh) or mesh.faces.shape[0] == 0:
        raise PartNotFoundError(f"деталь '{part_id}' не содержит треугольной геометрии")

    world_transform = None
    for node in scene.graph.nodes_geometry:
        transform, geom_name = scene.graph.get(node)
        if geom_name == part_id:
            world_transform = transform
            break

    result = mesh.copy()
    if world_transform is not None:
        result.apply_transform(world_transform)
    return result


def generate_part_previews(canonical_path, part_id: str, glb_path, thumbnail_path):
    """Рендерит GLB + webp для одной детали — тот же контракт, что `preview.generate_previews`."""
    mesh = load_part_mesh(canonical_path, part_id)
    return generate_previews(mesh, glb_path, thumbnail_path)
