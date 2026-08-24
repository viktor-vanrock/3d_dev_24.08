from pathlib import Path

import pytest
import trimesh

from mesh.convert import convert_to_3mf
from mesh.derivatives import DerivativeError, export_stl


def _fixture_canonical_3mf(tmp_path: Path) -> Path:
    box = trimesh.creation.box(extents=[10.0, 20.0, 30.0])
    stl = tmp_path / "box.stl"
    box.export(stl)
    canonical = tmp_path / "canonical.3mf"
    convert_to_3mf(stl, canonical)
    return canonical


def test_export_stl_produces_valid_stl_with_matching_geometry(tmp_path):
    canonical = _fixture_canonical_3mf(tmp_path)
    out = tmp_path / "box.stl"

    export_stl(canonical, out)

    assert out.exists()
    reloaded = trimesh.load(out, force="mesh")
    assert reloaded.faces.shape[0] > 0
    # Автоориентация (MF-827) может повернуть сборку на устойчивую грань —
    # проверяем набор габаритов, не порядок осей исходника.
    extents = (reloaded.bounds[1] - reloaded.bounds[0]).tolist()
    assert sorted(extents) == pytest.approx([10.0, 20.0, 30.0], abs=1e-3)


def test_export_stl_rejects_corrupt_canonical(tmp_path):
    junk = tmp_path / "broken.3mf"
    junk.write_bytes(b"not a 3mf file at all")
    out = tmp_path / "broken.stl"

    with pytest.raises(DerivativeError):
        export_stl(junk, out)
