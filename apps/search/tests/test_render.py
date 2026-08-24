"""Юнит-тесты multi-view рендера — синтетическая геометрия trimesh, без файлов."""

from __future__ import annotations

import numpy as np
import pytest
import trimesh

from portal_search.render import DEFAULT_VIEWS, RenderError, load_mesh, render_views


def _elongated_box() -> trimesh.Trimesh:
    """Асимметричный по осям бокс — разные ракурсы должны давать разные силуэты."""
    return trimesh.creation.box(extents=[10.0, 2.0, 2.0])


def test_render_views_returns_one_png_per_view():
    views = render_views(_elongated_box(), size=64)
    assert len(views) == len(DEFAULT_VIEWS)
    for view, (azimuth, elevation) in zip(views, DEFAULT_VIEWS, strict=True):
        assert view.azimuth_deg == azimuth
        assert view.elevation_deg == elevation
        assert view.png_bytes[:8] == b"\x89PNG\r\n\x1a\n"


def test_render_views_different_azimuths_differ():
    views = render_views(_elongated_box(), size=64)
    front = views[0].png_bytes
    side = views[1].png_bytes
    assert front != side


def test_render_views_custom_size():
    from io import BytesIO

    from PIL import Image

    views = render_views(_elongated_box(), size=32, views=((0.0, 25.0),))
    img = Image.open(BytesIO(views[0].png_bytes))
    assert img.size == (32, 32)


def test_render_views_empty_mesh_raises():
    empty = trimesh.Trimesh(vertices=np.zeros((0, 3)), faces=np.zeros((0, 3), dtype=int))
    with pytest.raises(RenderError):
        render_views(empty)


def test_render_views_degenerate_zero_extent_raises():
    verts = np.array([[1.0, 1.0, 1.0]] * 3)
    faces = np.array([[0, 1, 2]])
    degenerate = trimesh.Trimesh(vertices=verts, faces=faces, process=False)
    with pytest.raises(RenderError):
        render_views(degenerate)


def test_load_mesh_stl_roundtrip():
    original = _elongated_box()
    stl_bytes = original.export(file_type="stl")
    loaded = load_mesh(stl_bytes, "stl")
    assert loaded.faces.shape[0] > 0


def test_load_mesh_garbage_raises():
    with pytest.raises(RenderError):
        load_mesh(b"not a real mesh file", "stl")


def test_load_mesh_empty_bytes_raises():
    with pytest.raises(RenderError):
        load_mesh(b"", "stl")
