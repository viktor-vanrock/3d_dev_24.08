import zipfile
from dataclasses import replace
from pathlib import Path

import pytest

from mesh.errors import RejectCode, RejectionError
from mesh.limits import load_limits
from mesh.zip_safety import check_zip_safety


def _make_zip(tmp_path, name: str, members: dict[str, bytes]) -> Path:
    path = tmp_path / name
    with zipfile.ZipFile(path, "w") as archive:
        for member_name, data in members.items():
            archive.writestr(member_name, data)
    return path


def test_valid_zip_passes(tmp_path):
    path = _make_zip(
        tmp_path, "ok.3mf", {"[Content_Types].xml": b"<a/>", "3D/3dmodel.model": b"<b/>"}
    )

    check_zip_safety(path, load_limits())  # не должно кидать


def test_path_traversal_member_rejected(tmp_path):
    path = _make_zip(tmp_path, "traversal.3mf", {"../../etc/passwd": b"pwned"})

    with pytest.raises(RejectionError) as exc_info:
        check_zip_safety(path, load_limits())

    assert exc_info.value.code == RejectCode.PATH_TRAVERSAL


def test_absolute_path_member_rejected(tmp_path):
    path = _make_zip(tmp_path, "absolute.3mf", {"/etc/passwd": b"pwned"})

    with pytest.raises(RejectionError) as exc_info:
        check_zip_safety(path, load_limits())

    assert exc_info.value.code == RejectCode.PATH_TRAVERSAL


def test_zip_bomb_ratio_rejected(tmp_path):
    # Крайне сжимаемые данные (нули) дают огромное отношение uncompressed/compressed.
    path = tmp_path / "bomb.3mf"
    with zipfile.ZipFile(path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("payload.bin", b"\x00" * (50 * 1024 * 1024))

    limits = replace(
        load_limits(), max_zip_compression_ratio=10.0, max_zip_uncompressed_bytes=1024**4
    )

    with pytest.raises(RejectionError) as exc_info:
        check_zip_safety(path, limits)

    assert exc_info.value.code == RejectCode.ZIP_BOMB


def test_zip_total_uncompressed_size_over_limit_rejected(tmp_path):
    path = _make_zip(tmp_path, "toolarge.3mf", {"a.bin": b"x" * 1000, "b.bin": b"y" * 1000})
    limits = replace(load_limits(), max_zip_uncompressed_bytes=500)

    with pytest.raises(RejectionError) as exc_info:
        check_zip_safety(path, limits)

    assert exc_info.value.code == RejectCode.ZIP_BOMB


def test_too_many_entries_rejected(tmp_path):
    path = tmp_path / "many.3mf"
    with zipfile.ZipFile(path, "w") as archive:
        for i in range(20):
            archive.writestr(f"f{i}.bin", b"x")
    limits = replace(load_limits(), max_zip_entries=5)

    with pytest.raises(RejectionError) as exc_info:
        check_zip_safety(path, limits)

    assert exc_info.value.code == RejectCode.ZIP_BOMB
