import io
import json
import zipfile
from pathlib import Path

import lib3mf
import trimesh
from fastapi.testclient import TestClient
from PIL import Image

from mesh import main
from mesh.config import S3Config
from mesh.make_photos import DuplicatePhotoError, MakeNotFoundError, MakePhotoRecord
from mesh.slicer_engine import UnsupportedSlicerError

client = TestClient(app := main.app)


def test_health():
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok", "service": "mesh"}


def test_convert_returns_3mf_and_structured_report(tmp_path: Path):
    source = tmp_path / "cube.stl"
    trimesh.creation.box(extents=[10, 10, 10]).export(source)

    response = client.post(
        "/convert",
        data={"unit": "mm", "mode": "strict", "title": "Cube"},
        files={"file": (source.name, source.read_bytes(), "model/stl")},
    )

    assert response.status_code == 200
    assert response.headers["content-type"] == "application/vnd.ms-package.3dmanufacturing-3mf"
    assert response.headers["content-disposition"].startswith("attachment;")
    report = json.loads(response.headers["x-mesh-report"])
    assert report["unit"] == "mm"
    assert report["mode"] == "strict"
    assert report["bbox"]["size"] == [10.0, 10.0, 10.0]
    assert report["memory_peak_bytes"] > 0
    assert report["toolchain_versions"]
    assert len(report["parts"]) == 1
    assert report["parts"][0]["before"]["watertight"] is True
    with zipfile.ZipFile(io.BytesIO(response.content)) as archive:
        assert "3D/3dmodel.model" in archive.namelist()
    output = tmp_path / "canonical.3mf"
    output.write_bytes(response.content)
    model = lib3mf.Wrapper().CreateModel()
    model.QueryReader("3mf").ReadFromFile(str(output))
    objects = model.GetMeshObjects()
    assert objects.MoveNext()


def test_convert_rejects_input_over_limit_with_structured_error(monkeypatch):
    monkeypatch.setenv("MESH_MAX_FILE_BYTES", "3")

    response = client.post(
        "/convert",
        files={"file": ("model.stl", b"1234", "model/stl")},
    )

    assert response.status_code == 413
    assert response.json() == {
        "error": "conversion_rejected",
        "code": "too_large",
        "message": "входной файл превышает лимит 3 байт",
    }


def _fake_photo_bytes() -> bytes:
    buffer = io.BytesIO()
    Image.new("RGB", (400, 400), (10, 10, 10)).save(buffer, format="JPEG")
    return buffer.getvalue()


def _fake_s3_config() -> S3Config:
    return S3Config(
        endpoint="http://fake",
        region="ru-central-1",
        access_key="x",
        secret_key="y",
        bucket_models="3mf",
    )


def _fake_getenv(key: str) -> str | None:
    return "postgres://fake" if key == "DATABASE_URL" else None


def test_create_make_photo_returns_created_record(monkeypatch):
    monkeypatch.setattr(main, "load_s3_config", lambda: _fake_s3_config())
    monkeypatch.setattr(main.os, "getenv", _fake_getenv)
    monkeypatch.setattr(main.psycopg, "connect", lambda _url: _NullConnCtx())
    monkeypatch.setattr(main, "ObjectStore", lambda _config: object())

    def _fake_insert(_conn, _store, make_id, _variants, moderation_status, _phash):
        return MakePhotoRecord(
            id="photo-1",
            make_id=make_id,
            s3_key=f"makes/{make_id}/photos/photo-1/full.webp",
            position=0,
            is_cover=True,
            moderation_status=moderation_status,
        )

    monkeypatch.setattr(main, "insert_make_photo", _fake_insert)

    response = client.post(
        "/make-photos",
        data={"make_id": "make-1"},
        files={"file": ("photo.jpg", _fake_photo_bytes(), "image/jpeg")},
    )

    assert response.status_code == 201
    body = response.json()
    assert body["make_id"] == "make-1"
    assert body["is_cover"] is True


def test_create_make_photo_rejects_invalid_image():
    response = client.post(
        "/make-photos",
        data={"make_id": "make-1"},
        files={"file": ("photo.jpg", b"not an image", "image/jpeg")},
    )
    assert response.status_code == 422


def test_create_make_photo_unknown_make_returns_404(monkeypatch):
    monkeypatch.setattr(main, "load_s3_config", lambda: _fake_s3_config())
    monkeypatch.setattr(main.os, "getenv", _fake_getenv)
    monkeypatch.setattr(main.psycopg, "connect", lambda _url: _NullConnCtx())
    monkeypatch.setattr(main, "ObjectStore", lambda _config: object())

    def _fake_insert(_conn, _store, make_id, _variants, _moderation_status, _phash):
        raise MakeNotFoundError(make_id)

    monkeypatch.setattr(main, "insert_make_photo", _fake_insert)

    response = client.post(
        "/make-photos",
        data={"make_id": "missing"},
        files={"file": ("photo.jpg", _fake_photo_bytes(), "image/jpeg")},
    )
    assert response.status_code == 404


def test_create_make_photo_rejects_perceptual_duplicate_under_another_model(monkeypatch):
    """MF-780: то же кадр под другой моделью — 422 DUPLICATE_PHOTO с id существующего Make."""
    monkeypatch.setattr(main, "load_s3_config", lambda: _fake_s3_config())
    monkeypatch.setattr(main.os, "getenv", _fake_getenv)
    monkeypatch.setattr(main.psycopg, "connect", lambda _url: _NullConnCtx())
    monkeypatch.setattr(main, "ObjectStore", lambda _config: object())

    def _fake_insert(_conn, _store, _make_id, _variants, _moderation_status, _phash):
        raise DuplicatePhotoError("make-original")

    monkeypatch.setattr(main, "insert_make_photo", _fake_insert)

    response = client.post(
        "/make-photos",
        data={"make_id": "make-2"},
        files={"file": ("photo.jpg", _fake_photo_bytes(), "image/jpeg")},
    )
    assert response.status_code == 422
    body = response.json()["detail"]
    assert body["error"] == "DUPLICATE_PHOTO"
    assert body["existing_make_id"] == "make-original"


def test_create_make_photo_without_config_returns_503(monkeypatch):
    monkeypatch.setattr(main, "load_s3_config", lambda: None)
    monkeypatch.setattr(main.os, "getenv", lambda _key: None)

    response = client.post(
        "/make-photos",
        data={"make_id": "make-1"},
        files={"file": ("photo.jpg", _fake_photo_bytes(), "image/jpeg")},
    )
    assert response.status_code == 503


class _NullConnCtx:
    """Фейковый psycopg-коннекшн как context manager — вставку подменяет insert_make_photo."""

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


def test_get_prusa_ini_returns_resolved_text(monkeypatch):
    monkeypatch.setattr(main.os, "getenv", _fake_getenv)
    monkeypatch.setattr(main.psycopg, "connect", lambda _url: _NullConnCtx())

    def _fake_resolve(_conn, profile_id):
        assert profile_id == "profile-1"
        return "[print]\nwall_loops = 2\n", {"wall_loops": 2}

    monkeypatch.setattr(main, "resolve_prusa_ini", _fake_resolve)

    response = client.get("/slicer-profiles/profile-1/prusa-ini")

    assert response.status_code == 200
    assert response.json() == {
        "profile_id": "profile-1",
        "ini": "[print]\nwall_loops = 2\n",
        "params": {"wall_loops": 2},
    }


def test_get_prusa_ini_rejects_unsupported_slicer(monkeypatch):
    monkeypatch.setattr(main.os, "getenv", _fake_getenv)
    monkeypatch.setattr(main.psycopg, "connect", lambda _url: _NullConnCtx())

    def _fake_resolve(_conn, _profile_id):
        raise UnsupportedSlicerError("профиль x — слайсер 'cura', резолвер MVP умеет только prusa")

    monkeypatch.setattr(main, "resolve_prusa_ini", _fake_resolve)

    response = client.get("/slicer-profiles/profile-2/prusa-ini")

    assert response.status_code == 422
    assert response.json()["detail"]["error"] == "unsupported_slicer"


def test_get_prusa_ini_without_config_returns_503(monkeypatch):
    monkeypatch.setattr(main.os, "getenv", lambda _key: None)

    response = client.get("/slicer-profiles/profile-1/prusa-ini")

    assert response.status_code == 503
