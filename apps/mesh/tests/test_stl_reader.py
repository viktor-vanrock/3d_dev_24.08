import struct
from dataclasses import replace

import pytest

from mesh.errors import RejectCode, RejectionError
from mesh.limits import load_limits
from mesh.stl_reader import check_stl_input, load_stl_mesh, sniff_stl

_TRIANGLE = struct.pack("<12fH", 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0)


def _binary_stl_bytes(declared_count: int, actual_count: int) -> bytes:
    header = b"MF-378 test stl".ljust(80, b"\x00")
    return header + struct.pack("<I", declared_count) + _TRIANGLE * actual_count


def _write(tmp_path, name: str, data: bytes):
    path = tmp_path / name
    path.write_bytes(data)
    return path


def test_valid_binary_stl_round_trips(tmp_path):
    path = _write(tmp_path, "valid.stl", _binary_stl_bytes(2, 2))
    limits = load_limits()

    declared = check_stl_input(path, limits)

    assert declared == 2
    mesh = load_stl_mesh(path, limits)
    assert mesh.faces.shape[0] == 2


def test_empty_file_rejected(tmp_path):
    path = _write(tmp_path, "empty.stl", b"")

    with pytest.raises(RejectionError) as exc_info:
        check_stl_input(path, load_limits())

    assert exc_info.value.code == RejectCode.EMPTY_FILE


def test_truncated_binary_stl_rejected(tmp_path):
    # Заявлено 5 треугольников, реально записаны данные только под 2.
    path = _write(tmp_path, "truncated.stl", _binary_stl_bytes(5, 2))

    with pytest.raises(RejectionError) as exc_info:
        check_stl_input(path, load_limits())

    assert exc_info.value.code == RejectCode.TRUNCATED


def test_declared_count_over_limit_rejected_before_size_math(tmp_path):
    # Маленький файл, но заявленный count огромный — должен отклоняться по
    # лимиту треугольников, не доходя до арифметики над размером.
    path = _write(tmp_path, "overclaim.stl", _binary_stl_bytes(1_000_000, 1))
    limits = replace(load_limits(), max_triangles=10)

    with pytest.raises(RejectionError) as exc_info:
        check_stl_input(path, limits)

    assert exc_info.value.code == RejectCode.TOO_MANY_TRIANGLES


def test_file_over_size_limit_rejected(tmp_path):
    path = _write(tmp_path, "big.stl", _binary_stl_bytes(2, 2))
    limits = replace(load_limits(), max_file_bytes=10)

    with pytest.raises(RejectionError) as exc_info:
        check_stl_input(path, limits)

    assert exc_info.value.code == RejectCode.TOO_LARGE


def test_ascii_stl_detected_without_declared_count(tmp_path):
    ascii_stl = (
        b"solid test\n"
        b"facet normal 0 0 1\n"
        b"outer loop\n"
        b"vertex 0 0 0\n"
        b"vertex 1 0 0\n"
        b"vertex 0 1 0\n"
        b"endloop\n"
        b"endfacet\n"
        b"endsolid test\n"
    )
    path = _write(tmp_path, "ascii.stl", ascii_stl)

    is_ascii, declared_count = sniff_stl(path, path.stat().st_size)

    assert is_ascii is True
    assert declared_count is None
    assert check_stl_input(path, load_limits()) is None


def test_load_stl_mesh_end_to_end(tmp_path):
    # Куб из trimesh — реальный, geometrически валидный бинарный STL.
    import trimesh

    box = trimesh.creation.box(extents=[10.0, 20.0, 30.0])
    path = tmp_path / "box.stl"
    box.export(path)

    mesh = load_stl_mesh(path, load_limits())

    assert mesh.faces.shape[0] == 12
