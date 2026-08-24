"""S3-доступ к бакету `3mf` (cloud.ru): скачивание source, заливка canonical_3mf.

Ключи — `{protected|public}/models/{model_id}/{role}.{ext}` (нейтральны к ремеслу,
см. `docs/epics/3mf.storage.md` § модель данных, `docs/infra/readme.md` § «Bucket-policy
hardening `3mf`», MF-754/755). `protected/` — source/canonical_3mf (bucket policy fail-closed,
доступ только presigned/service-креды); `public/` — preview/thumbnail (public-read).
Path-style, как в `apps/api/src/storage/s3.ts`.
"""

from __future__ import annotations

import hashlib
from pathlib import Path

import boto3

from .config import S3Config


class ObjectStore:
    """Тонкая обёртка над S3-клиентом для моделей."""

    def __init__(self, config: S3Config) -> None:
        self._bucket = config.bucket_models
        self._client = boto3.client(
            "s3",
            endpoint_url=config.endpoint,
            region_name=config.region,
            aws_access_key_id=config.access_key,
            aws_secret_access_key=config.secret_key,
        )

    def download(self, key: str, destination: Path) -> None:
        """Скачивает объект по ключу в локальный файл."""
        self._client.download_file(self._bucket, key, str(destination))

    def upload(self, source: Path, key: str, content_type: str) -> None:
        """Заливает локальный файл под ключ с указанным Content-Type."""
        self._client.upload_file(
            str(source),
            self._bucket,
            key,
            ExtraArgs={"ContentType": content_type},
        )

    def upload_bytes(self, data: bytes, key: str, content_type: str) -> None:
        """Заливает байты напрямую (без временного файла) — варианты фото Make, MF-783."""
        self._client.put_object(Bucket=self._bucket, Key=key, Body=data, ContentType=content_type)


def canonical_3mf_key(model_id: str, revision_id: str) -> str:
    """Immutable canonical 3MF key for one model revision."""
    return f"protected/models/{model_id}/revisions/{revision_id}/canonical_3mf.3mf"


def preview_glb_key(model_id: str, revision_id: str) -> str:
    """Immutable public GLB preview key for one model revision."""
    return f"public/models/{model_id}/revisions/{revision_id}/preview.glb"


def thumbnail_webp_key(model_id: str, revision_id: str) -> str:
    """Ключ webp-миниатюры каталога (та же роль отдаёт статичное превью
    ленты, public/ — MF-754/755)."""
    return f"public/models/{model_id}/revisions/{revision_id}/thumb.webp"


def mobile_preview_glb_key(model_id: str, revision_id: str) -> str:
    """Ключ облегчённого GLB под мобильный VRAM-бюджет (MF-433, public/ — MF-754/755)."""
    return f"public/models/{model_id}/revisions/{revision_id}/preview.mobile.glb"


def stl_derivative_key(model_id: str, revision_id: str) -> str:
    """Ключ STL-деривативa для скачивания (MF-377, protected/ — та же полнота геометрии,
    что и canonical_3mf, поэтому тот же приватный prefix, не public/ как у preview/thumb)."""
    return f"protected/models/{model_id}/revisions/{revision_id}/stl_derivative.stl"


def legacy_canonical_3mf_key(model_id: str) -> str:
    """Read-only compatibility key for pre-revision assets; never use for new writes."""
    return f"protected/models/{model_id}/canonical_3mf.3mf"


def legacy_preview_glb_key(model_id: str) -> str:
    return f"public/models/{model_id}/preview.glb"


def legacy_thumbnail_webp_key(model_id: str) -> str:
    return f"public/models/{model_id}/thumb.webp"


def legacy_mobile_preview_glb_key(model_id: str) -> str:
    return f"public/models/{model_id}/preview.mobile.glb"


def legacy_stl_derivative_key(model_id: str) -> str:
    return f"protected/models/{model_id}/stl_derivative.stl"


def part_id_slug(part_id: str) -> str:
    """Детерминированный безопасный сегмент S3-пути для `part_id` (MF-1011).

    `part_id` — имя объекта внутри канонического 3MF (см. `mesh.part_preview`),
    в конечном счёте заданное автором исходника (сцена OBJ/3MF): кириллица,
    пробелы, слэши — обычный вражеский вход. Хэшируем вместо санитайза, чтобы
    не городить правила экранирования и не расходиться с потребителем —
    формула (`sha256(part_id)[:20]`) — контракт для `apps/api`
    (packages/contracts/jobs/mesh.ts), а не деталь реализации.
    """
    return hashlib.sha256(part_id.encode("utf-8")).hexdigest()[:20]


def part_preview_glb_key(model_id: str, revision_id: str, part_id: str) -> str:
    """Ключ GLB-превью отдельной детали внутри мультиобъектного 3MF (MF-1011, public/)."""
    return (
        f"public/models/{model_id}/revisions/{revision_id}/parts/"
        f"{part_id_slug(part_id)}/preview.glb"
    )


def part_thumbnail_webp_key(model_id: str, revision_id: str, part_id: str) -> str:
    """Ключ webp-миниатюры отдельной детали внутри мультиобъектного 3MF (MF-1011, public/)."""
    return (
        f"public/models/{model_id}/revisions/{revision_id}/parts/"
        f"{part_id_slug(part_id)}/thumb.webp"
    )


def legacy_part_preview_glb_key(model_id: str, part_id: str) -> str:
    return f"public/models/{model_id}/parts/{part_id_slug(part_id)}/preview.glb"


def legacy_part_thumbnail_webp_key(model_id: str, part_id: str) -> str:
    return f"public/models/{model_id}/parts/{part_id_slug(part_id)}/thumb.webp"


def slice_gcode_key(account_id: str, slice_key_hex: str) -> str:
    """Ключ g-code слайс-кэша (MF-1248-04): account-scoped по `account_id` и
    content-addressed внутри аккаунта по `slice_key` (`slicing_queue.compute_slice_key`).
    Приватный prefix — тот же уровень доступа, что source/canonical_3mf
    (presigned/service-креды только), см. 3mf.storage.md.

    Account ID не является пользовательским вводом: его передаёт авторизованный
    владелец джобы. Отдельный сегмент не позволяет случайно переиспользовать
    presigned-объект другого аккаунта даже при одинаковом fingerprint.
    """
    return f"protected/slices/{account_id}/{slice_key_hex}.gcode"


def slice_preview_manifest_key(account_id: str, slice_key_hex: str) -> str:
    """Ключ preview-манифеста `slice-preview.v1` (MF-1987, project-slice-request.v1)
    — тот же account-scoped приватный prefix, что и g-code слайс-кэша
    (`slice_gcode_key`): один и тот же `slice_key` привязывает и g-code, и
    манифест к одному результату слайса."""
    return f"protected/slices/{account_id}/{slice_key_hex}.preview.json"


def make_photo_key(make_id: str, photo_id: str, variant: str) -> str:
    """Ключ варианта фото Make: makes/{make_id}/photos/{photo_id}/{variant}.webp (MF-783).

    `variant` — thumb/medium/full (`mesh.photo.VARIANT_SPECS`). Непубличный namespace
    в том же приватном бакете `3mf`, что модели — не отдельный бакет ради этого.
    `make_photos.s3_key` в БД хранит ровно ключ варианта 'full'; thumb/medium
    выводятся подменой сегмента (`make_photo_variant_key`), тот же принцип, что
    `modelObjectKey()` в apps/api/src/storage/s3.ts.
    """
    return f"makes/{make_id}/photos/{photo_id}/{variant}.webp"


def make_photo_variant_key(full_key: str, variant: str) -> str:
    """Меняет вариант в уже собранном ключе (например, сохранённый в БД full_key → thumb_key)."""
    if not full_key.endswith("/full.webp"):
        raise ValueError(f"ожидался ключ варианта 'full', получено: {full_key}")
    return full_key[: -len("full.webp")] + f"{variant}.webp"
