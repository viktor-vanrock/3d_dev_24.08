"""Ветка scan (MF-2075) — договор с сервисом сборки и разбор его ответов.

Сам COLMAP тут не гоняем: это минуты счёта на GPU, которого у тестов нет. Проверяем то, что
ломается в жизни, — как ветка ведёт себя, когда кадров нет, когда сервис недоступен, когда
сборка отказала по существу, и что она не тащит в результат обрывки фона.
"""

from __future__ import annotations

import pytest
import trimesh

from giga.branches.base import GenerationError, GenerationJob
from giga.branches.scan import _largest_part, _service_url, run_scan


def _job(**params) -> GenerationJob:
    return GenerationJob(id="j1", branch="scan", prompt="Съёмка предмета", params=params)


def test_requires_scan_id() -> None:
    with pytest.raises(GenerationError, match="scan_id"):
        run_scan(_job())


def test_service_url_from_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("SCAN_SERVICE_URL", "http://example.test:9000/")
    # Хвостовой слэш срезается — иначе адреса склеивались бы с двойным слэшем.
    assert _service_url() == "http://example.test:9000"


def test_service_url_has_default(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("SCAN_SERVICE_URL", raising=False)
    assert _service_url().startswith("http://")


def test_largest_part_drops_scraps() -> None:
    """Фотограмметрия ловит вместе с предметом обрывки фона. Отдельно висящие куски —
    заведомо мусор, и ветка должна оставить только самый крупный."""
    subject = trimesh.creation.box(extents=(2, 2, 2))
    scrap = trimesh.creation.box(extents=(0.2, 0.2, 0.2))
    scrap.apply_translation([10, 10, 10])
    combined = trimesh.util.concatenate([subject, scrap])

    kept = _largest_part(combined)
    assert len(kept.faces) == len(subject.faces)
    # Габарит крупного куска, а не всей сцены с отлетевшим обрывком.
    assert kept.extents.max() == pytest.approx(2.0, abs=1e-6)


def test_largest_part_keeps_single_piece() -> None:
    single = trimesh.creation.box(extents=(1, 1, 1))
    assert len(_largest_part(single).faces) == len(single.faces)


def test_missing_photos_is_an_error(monkeypatch: pytest.MonkeyPatch) -> None:
    """Пустой префикс — не повод молча собрать пустоту."""
    from giga.branches import scan as scan_module

    class _Store:
        def __init__(self, *args, **kwargs) -> None: ...
        def list_keys(self, prefix: str) -> list[str]:
            return []

    monkeypatch.setattr(scan_module.storage, "ObjectStore", _Store)
    monkeypatch.setattr(
        scan_module, "load_s3_config", lambda: object()
    )
    with pytest.raises(GenerationError, match="кадры не доехали"):
        run_scan(_job(scan_id="u1/s1"))


def test_service_failure_is_reported(monkeypatch: pytest.MonkeyPatch) -> None:
    """Сервис недоступен — человеку должно достаться внятное «не собралось», а не трейс."""
    from giga.branches import scan as scan_module

    class _Store:
        def __init__(self, *args, **kwargs) -> None: ...
        def list_keys(self, prefix: str) -> list[str]:
            return [f"{prefix}0000.jpg"]
        def download_bytes(self, key: str) -> bytes:
            return b"not-really-a-jpeg"

    def _boom(*args, **kwargs):
        raise scan_module.httpx.ConnectError("нет маршрута")

    monkeypatch.setattr(scan_module.storage, "ObjectStore", _Store)
    monkeypatch.setattr(scan_module, "load_s3_config", lambda: object())
    monkeypatch.setattr(scan_module.httpx, "post", _boom)

    with pytest.raises(GenerationError, match="сервис сборки недоступен"):
        run_scan(_job(scan_id="u1/s1"))
