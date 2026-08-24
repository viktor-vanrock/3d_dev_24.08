"""Юнит-тесты превью отдельной детали мультиобъектного 3MF (MF-1011)."""

from pathlib import Path

import numpy as np
import pytest
import trimesh

from mesh.convert import convert_to_3mf
from mesh.part_preview import (
    PartNotFoundError,
    generate_part_previews,
    list_part_ids,
    load_part_mesh,
)
from mesh.storage import (
    legacy_part_preview_glb_key as part_preview_glb_key,
)
from mesh.storage import (
    legacy_part_thumbnail_webp_key as part_thumbnail_webp_key,
)
from mesh.storage import (
    part_id_slug,
)


def _fixture_multipart_colored_obj(tmp_path: Path) -> Path:
    # Тот же приём, что в test_convert.py: OBJ+MTL руками, два объекта в разных
    # точках пространства (partA у начала координат, partB сдвинут на +20 по X).
    box_a = trimesh.creation.box(extents=[10.0, 10.0, 10.0])
    box_b = trimesh.creation.box(extents=[5.0, 5.0, 5.0])
    box_b.apply_translation([20.0, 0.0, 0.0])

    mtl_path = tmp_path / "multi.mtl"
    mtl_path.write_text("newmtl red\nKd 1.0 0.0 0.0\n\nnewmtl green\nKd 0.0 1.0 0.0\n")

    lines = ["mtllib multi.mtl"]
    offset = 0
    for name, mesh, material in (("partA", box_a, "red"), ("partB", box_b, "green")):
        lines.append(f"o {name}")
        lines.append(f"usemtl {material}")
        for v in mesh.vertices:
            lines.append(f"v {v[0]} {v[1]} {v[2]}")
        for f in mesh.faces:
            lines.append("f " + " ".join(str(i + 1 + offset) for i in f))
        offset += len(mesh.vertices)

    obj_path = tmp_path / "multi.obj"
    obj_path.write_text("\n".join(lines) + "\n")
    return obj_path


def _fixture_single_part_stl(tmp_path: Path) -> Path:
    box = trimesh.creation.box(extents=[10.0, 20.0, 30.0])
    stl = tmp_path / "box.stl"
    box.export(stl)
    return stl


def test_list_part_ids_returns_both_objects(tmp_path):
    obj = _fixture_multipart_colored_obj(tmp_path)
    canonical = tmp_path / "multi.3mf"
    convert_to_3mf(obj, canonical)

    part_ids = list_part_ids(canonical)

    assert len(part_ids) == 2


def test_load_part_mesh_unknown_id_lists_available(tmp_path):
    obj = _fixture_multipart_colored_obj(tmp_path)
    canonical = tmp_path / "multi.3mf"
    convert_to_3mf(obj, canonical)
    available = list_part_ids(canonical)

    with pytest.raises(PartNotFoundError) as exc_info:
        load_part_mesh(canonical, "does-not-exist")
    for part_id in available:
        assert part_id in str(exc_info.value)


def test_load_part_mesh_applies_world_transform(tmp_path):
    obj = _fixture_multipart_colored_obj(tmp_path)
    canonical = tmp_path / "multi.3mf"
    convert_to_3mf(obj, canonical)
    part_ids = list_part_ids(canonical)

    meshes = [load_part_mesh(canonical, pid) for pid in part_ids]
    centers = [m.bounds.mean(axis=0) for m in meshes]

    # partA у начала координат, partB сдвинут на +20 по исходной оси X — конвертер
    # вправе переориентировать сборку под печать (см. `_stable_orientation_transform`),
    # так что после round-trip разница может лечь на другую ось; важно, что она вообще
    # есть — детали не должны схлопнуться в одну точку/наложиться друг на друга.
    assert float(np.linalg.norm(centers[1] - centers[0])) > 15.0


def test_load_part_mesh_single_object_3mf(tmp_path):
    stl = _fixture_single_part_stl(tmp_path)
    canonical = tmp_path / "box.3mf"
    convert_to_3mf(stl, canonical)

    part_ids = list_part_ids(canonical)
    assert len(part_ids) == 1
    mesh = load_part_mesh(canonical, part_ids[0])
    assert mesh.faces.shape[0] > 0


def test_generate_part_previews_writes_glb_and_webp(tmp_path):
    obj = _fixture_multipart_colored_obj(tmp_path)
    canonical = tmp_path / "multi.3mf"
    convert_to_3mf(obj, canonical)
    part_id = list_part_ids(canonical)[0]

    glb_path = tmp_path / "part.glb"
    thumb_path = tmp_path / "part.webp"
    generate_part_previews(canonical, part_id, glb_path, thumb_path)

    assert glb_path.exists() and glb_path.stat().st_size > 0
    assert thumb_path.exists() and thumb_path.stat().st_size > 0
    reloaded = trimesh.load(glb_path, force="mesh")
    assert reloaded.faces.shape[0] > 0


def test_part_id_slug_deterministic_and_url_safe(tmp_path):
    slug_a = part_id_slug("Крышка №1 / часть")
    slug_b = part_id_slug("Крышка №1 / часть")
    slug_other = part_id_slug("другая деталь")

    assert slug_a == slug_b
    assert slug_a != slug_other
    assert all(c.isalnum() for c in slug_a)


def test_part_preview_keys_differ_per_part():
    assert part_preview_glb_key("mid", "partA") != part_preview_glb_key("mid", "partB")
    assert part_thumbnail_webp_key("mid", "partA") != part_thumbnail_webp_key("mid", "partB")
